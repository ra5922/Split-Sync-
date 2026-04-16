const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /expenses/new?group_id=X
router.get('/new', async (req, res) => {
  const { group_id } = req.query;
  const userId = req.session.user.id;
  try {
    const memberCheck = await pool.query('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [group_id, userId]);
    if (memberCheck.rows.length === 0) { req.flash('error', 'Access denied'); return res.redirect('/groups'); }

    const group = await pool.query('SELECT * FROM groups WHERE id = $1', [group_id]);
    const members = await pool.query(`
      SELECT u.id, u.name, u.avatar_color FROM users u
      JOIN group_members gm ON gm.user_id = u.id WHERE gm.group_id = $1 ORDER BY u.name
    `, [group_id]);

    res.render('expenses/new', { group: group.rows[0], members: members.rows });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load form');
    res.redirect('/groups');
  }
});

// POST /expenses
router.post('/', async (req, res) => {
  console.log('=== EXPENSE POST BODY ===', JSON.stringify(req.body, null, 2));

  const { group_id, paid_by, amount, description, category, discount, notes, split_type } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rawAmount = parseFloat(amount);
    const discountAmt = parseFloat(discount) || 0;
    const effectiveAmount = Math.round((rawAmount - discountAmt) * 100) / 100;
    const paidById = parseInt(paid_by);

    if (effectiveAmount <= 0) {
      req.flash('error', 'Effective amount after discount must be positive');
      await client.query('ROLLBACK');
      return res.redirect(`/expenses/new?group_id=${group_id}`);
    }

    const expense = await client.query(
      `INSERT INTO expenses (group_id, paid_by, amount, description, category, discount, notes, split_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [group_id, paidById, rawAmount, description.trim(), category || 'general', discountAmt, notes || null, split_type || 'equal']
    );
    const expenseId = expense.rows[0].id;

    if (split_type === 'custom') {
      // Parse custom_amounts — handle object, array, or flat key formats
      let customData = {};

      if (req.body.custom_amounts && typeof req.body.custom_amounts === 'object' && !Array.isArray(req.body.custom_amounts)) {
        // Correctly parsed as { "1": "50", "2": "150" }
        customData = req.body.custom_amounts;
      } else if (Array.isArray(req.body.custom_amounts)) {
        // Came as array — zip with split_members to recover user IDs
        const rawMembers = req.body.split_members;
        const memberIds = Array.isArray(rawMembers) ? rawMembers : (rawMembers ? [rawMembers] : []);
        req.body.custom_amounts.forEach(function(val, i) {
          if (memberIds[i]) customData[memberIds[i]] = val;
        });
      } else {
        // Flat key fallback
        for (const key of Object.keys(req.body)) {
          const match = key.match(/^custom_amounts\[(\d+)\]$/);
          if (match) customData[match[1]] = req.body[key];
        }
      }

      console.log('=== PARSED customData ===', customData);

      // Insert split for EVERY member with amount > 0 INCLUDING payer
      // calculateBalances skips payer's own row when computing debts
      let insertedCount = 0;

      for (const uid of Object.keys(customData)) {
        const val = parseFloat(customData[uid]) || 0;
        if (val <= 0) continue;

        const memberId = parseInt(uid);
        if (isNaN(memberId)) continue;

        const memberCheck = await client.query(
          'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
          [group_id, memberId]
        );
        if (memberCheck.rows.length === 0) {
          console.log(`User ${memberId} not in group, skipping`);
          continue;
        }

        // Apply discount proportionally
        const discountedShare = rawAmount > 0 ? val - (discountAmt * (val / rawAmount)) : val;
        const rounded = Math.round(discountedShare * 100) / 100;

        console.log(`Inserting split: user ${memberId} owes Rs.${rounded}`);
        await client.query(
          'INSERT INTO splits (expense_id, user_id, amount_owed) VALUES ($1, $2, $3)',
          [expenseId, memberId, rounded]
        );
        insertedCount++;
      }

      if (insertedCount === 0) {
        await client.query('ROLLBACK');
        req.flash('error', 'Please enter amounts for the members');
        return res.redirect(`/expenses/new?group_id=${group_id}`);
      }

    } else {
      // Equal split
      const rawMembers = req.body.split_members;
      const membersToSplit = Array.isArray(rawMembers)
        ? rawMembers.map(Number)
        : (rawMembers ? [Number(rawMembers)] : []);

      if (membersToSplit.length === 0) {
        req.flash('error', 'Select at least one member to split with');
        await client.query('ROLLBACK');
        return res.redirect(`/expenses/new?group_id=${group_id}`);
      }

      // Per person = effective amount / total people selected
      const perPerson = Math.round((effectiveAmount / membersToSplit.length) * 100) / 100;

      // Insert for ALL selected members INCLUDING payer
      for (const uid of membersToSplit) {
        await client.query(
          'INSERT INTO splits (expense_id, user_id, amount_owed) VALUES ($1, $2, $3)',
          [expenseId, uid, perPerson]
        );
      }
    }

    await client.query('COMMIT');
    req.flash('success', `Expense "${description}" added! Rs.${effectiveAmount.toFixed(2)}`);
    res.redirect(`/groups/${group_id}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('EXPENSE ERROR:', err.message);
    req.flash('error', err.message);
    res.redirect(`/expenses/new?group_id=${group_id}`);
  } finally {
    client.release();
  }
});

// GET /expenses/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const expense = await pool.query(`
      SELECT e.*, u.name AS paid_by_name, u.avatar_color AS paid_by_color, g.name AS group_name
      FROM expenses e JOIN users u ON u.id = e.paid_by JOIN groups g ON g.id = e.group_id
      WHERE e.id = $1
    `, [id]);
    if (expense.rows.length === 0) { req.flash('error', 'Expense not found'); return res.redirect('/groups'); }

    const splits = await pool.query(`
      SELECT s.*, u.name, u.avatar_color FROM splits s JOIN users u ON u.id = s.user_id
      WHERE s.expense_id = $1 ORDER BY u.name
    `, [id]);

    const rawAmount = parseFloat(expense.rows[0].amount);
    const discountAmt = parseFloat(expense.rows[0].discount) || 0;
    const effectiveAmount = rawAmount - discountAmt;
    const paidById = expense.rows[0].paid_by;

    const payerSplitRow = splits.rows.find(function(s) { return s.user_id === paidById; });
    const payerShare = payerSplitRow ? parseFloat(payerSplitRow.amount_owed) : 0;

    res.render('expenses/show', {
      expense: expense.rows[0],
      splits: splits.rows,
      payerShare,
      effectiveAmount,
      currentUserId: req.session.user.id
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load expense');
    res.redirect('/groups');
  }
});

// DELETE /expenses/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  try {
    const exp = await pool.query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (!exp.rows[0]) { req.flash('error', 'Not found'); return res.redirect('/groups'); }
    if (parseInt(exp.rows[0].paid_by) !== parseInt(userId)) {
      req.flash('error', 'Only the payer can delete this expense');
      return res.redirect(`/groups/${exp.rows[0].group_id}`);
    }
    const groupId = exp.rows[0].group_id;
    await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
    req.flash('success', 'Expense deleted');
    res.redirect(`/groups/${groupId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Delete failed');
    res.redirect('/groups');
  }
});

module.exports = router;
