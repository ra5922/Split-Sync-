const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /groups - list all groups for current user
router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  try {
    const groups = await pool.query(`
      SELECT g.*, u.name AS creator_name,
        (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count,
        (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id) AS expense_count,
        (SELECT COALESCE(SUM(e.amount - e.discount), 0) FROM expenses e WHERE e.group_id = g.id) AS total_spent
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      JOIN users u ON u.id = g.created_by
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
    `, [userId]);
    res.render('groups/index', { groups: groups.rows });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load groups');
    res.redirect('/');
  }
});

// GET /groups/new
router.get('/new', async (req, res) => {
  const allUsers = await pool.query('SELECT id, name, email FROM users WHERE id != $1 ORDER BY name', [req.session.user.id]);
  res.render('groups/new', { allUsers: allUsers.rows });
});

// POST /groups
router.post('/', async (req, res) => {
  const { name, category, members } = req.body;
  const userId = req.session.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = await client.query(
      'INSERT INTO groups (name, category, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), category || 'general', userId]
    );
    const groupId = group.rows[0].id;
    // Add creator
    await client.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [groupId, userId]);
    // Add other members
    const memberList = Array.isArray(members) ? members : (members ? [members] : []);
    for (const mid of memberList) {
      if (parseInt(mid) !== userId) {
        await client.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [groupId, mid]);
      }
    }
    await client.query('COMMIT');
    req.flash('success', `Group "${name}" created!`);
    res.redirect(`/groups/${groupId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    req.flash('error', 'Could not create group');
    res.redirect('/groups/new');
  } finally {
    client.release();
  }
});

// GET /groups/:id - group detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  try {
    // Check membership
    const memberCheck = await pool.query('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [id, userId]);
    if (memberCheck.rows.length === 0) { req.flash('error', 'Access denied'); return res.redirect('/groups'); }

    const group = await pool.query('SELECT * FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) { req.flash('error', 'Group not found'); return res.redirect('/groups'); }

    const members = await pool.query(`
      SELECT u.id, u.name, u.email, u.avatar_color FROM users u
      JOIN group_members gm ON gm.user_id = u.id WHERE gm.group_id = $1 ORDER BY u.name
    `, [id]);

    const expenses = await pool.query(`
      SELECT e.*, u.name AS paid_by_name, u.avatar_color AS paid_by_color,
        (SELECT json_agg(json_build_object('user_id', s.user_id, 'amount_owed', s.amount_owed, 'is_settled', s.is_settled, 'name', u2.name))
         FROM splits s JOIN users u2 ON u2.id = s.user_id WHERE s.expense_id = e.id) AS split_details
      FROM expenses e JOIN users u ON u.id = e.paid_by
      WHERE e.group_id = $1 ORDER BY e.created_at DESC
    `, [id]);
    console.log('EXPENSES COUNT:', expenses.rows.length);
console.log('FIRST EXPENSE:', expenses.rows[0])

    // Calculate balances (who owes whom)
    const balances = await calculateBalances(id, members.rows);

    // Settlements history
    const settlements = await pool.query(`
      SELECT s.*, u1.name AS from_name, u1.avatar_color AS from_color,
        u2.name AS to_name, u2.avatar_color AS to_color
      FROM settlements s
      JOIN users u1 ON u1.id = s.from_user
      JOIN users u2 ON u2.id = s.to_user
      WHERE s.group_id = $1 ORDER BY s.created_at DESC LIMIT 20
    `, [id]);

    // Per-member spending for chart
    const spendingData = await pool.query(`
      SELECT u.name, SUM(e.amount - e.discount) AS total
      FROM expenses e JOIN users u ON u.id = e.paid_by
      WHERE e.group_id = $1 GROUP BY u.name ORDER BY total DESC
    `, [id]);

// Category breakdown
    const categoryData = await pool.query(`
      SELECT category, SUM(amount - discount) AS total FROM expenses
      WHERE group_id = $1 GROUP BY category ORDER BY total DESC
    `, [id]);

    // Monthly trend data
    const monthlyData = await pool.query(`
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, SUM(amount - discount) as total
      FROM expenses WHERE group_id = $1 GROUP BY month ORDER BY month
    `, [id]);

    // Smart Insights
    const topSpender = spendingData.rows[0] ? `${spendingData.rows[0].name} (₹${parseFloat(spendingData.rows[0].total).toLocaleString('en-IN')})` : 'No data';
    const topCategory = categoryData.rows[0] ? `${categoryData.rows[0].category} (₹${parseFloat(categoryData.rows[0].total).toLocaleString('en-IN')})` : 'No data';
    const totalSpent = monthlyData.rows.reduce((sum, r) => sum + parseFloat(r.total), 0);
    let monthlyTrend = 'No previous data';
    if (monthlyData.rows.length >= 2) {
      const latest = parseFloat(monthlyData.rows[monthlyData.rows.length - 1].total);
      const previous = parseFloat(monthlyData.rows[monthlyData.rows.length - 2].total);
      const pct = ((latest - previous) / previous * 100).toFixed(1);
      monthlyTrend = pct > 0 ? `+${pct}% vs last month` : `${pct}% vs last month`;
    } else if (monthlyData.rows.length === 1) {
      monthlyTrend = `₹${parseFloat(monthlyData.rows[0].total).toLocaleString('en-IN')} this month`;
    }

    res.render('groups/show', {
      group: group.rows[0],
      members: members.rows,
      expenses: expenses.rows,
      balances,
      settlements: settlements.rows,
      spendingData: spendingData.rows,
      categoryData: categoryData.rows,
      monthlyData: monthlyData.rows,
      insights: {
        topSpender,
        topCategory,
        monthlyTrend,
        totalSpent: totalSpent.toLocaleString('en-IN')
      },
      currentUserId: userId
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load group');
    res.redirect('/groups');
  }
});

// POST /groups/:id/settle
router.post('/:id/settle', async (req, res) => {
  const { id } = req.params;
  const { to_user, amount, note } = req.body;
  const fromUser = req.session.user.id;
  try {
    await pool.query(
      'INSERT INTO settlements (group_id, from_user, to_user, amount, note) VALUES ($1, $2, $3, $4, $5)',
      [id, fromUser, to_user, parseFloat(amount), note || null]
    );
    // Mark relevant splits as settled
    await pool.query(`
      UPDATE splits SET is_settled = TRUE, settled_at = NOW()
      WHERE user_id = $1 AND expense_id IN (
        SELECT id FROM expenses WHERE group_id = $2 AND paid_by = $3
      ) AND is_settled = FALSE
    `, [fromUser, id, to_user]);
    req.flash('success', `Settlement of ₹${amount} recorded!`);
    res.redirect(`/groups/${id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Settlement failed');
    res.redirect(`/groups/${id}`);
  }
});

// DELETE /groups/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  try {
    const g = await pool.query('SELECT created_by FROM groups WHERE id = $1', [id]);
    if (!g.rows[0] || g.rows[0].created_by !== userId) {
      req.flash('error', 'Only the group creator can delete it');
      return res.redirect(`/groups/${id}`);
    }
    await pool.query('DELETE FROM groups WHERE id = $1', [id]);
    req.flash('success', 'Group deleted');
    res.redirect('/groups');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Delete failed');
    res.redirect('/groups');
  }
});

// Helper: calculate net balances
async function calculateBalances(groupId, members) {
  const net = {};
  members.forEach(function(m) {
    // FIX: ensure IDs are stored as integers for consistent comparison
    net[parseInt(m.id)] = { id: parseInt(m.id), name: m.name, avatar_color: m.avatar_color, net: 0 };
  });

  // Get all expenses for this group
  const expenses = await pool.query(
  
    'SELECT id, paid_by, amount, discount FROM expenses WHERE group_id = $1',
    [groupId]
    
  );

  for (const exp of expenses.rows) {
    // FIX: cast paid_by to int for reliable strict comparison
    const paidById = parseInt(exp.paid_by);

    const splits = await pool.query(
      'SELECT user_id, amount_owed FROM splits WHERE expense_id = $1',
      [exp.id]
    );

    splits.rows.forEach(function(split) {
      const splitUserId = parseInt(split.user_id);
      const amountOwed = parseFloat(split.amount_owed);

      // Skip if this split is for the person who paid (their own share)
      if (splitUserId === paidById) return;

      // splitUserId owes paidById the amount_owed
      if (net[splitUserId] !== undefined) net[splitUserId].net -= amountOwed;
      if (net[paidById] !== undefined) net[paidById].net += amountOwed;
    });
  }

  // Apply settlements — each settlement reduces what's owed
  const settlements = await pool.query(
    'SELECT from_user, to_user, amount FROM settlements WHERE group_id = $1',
    [groupId]
  );

  settlements.rows.forEach(function(row) {
    const fromUser = parseInt(row.from_user);
    const toUser = parseInt(row.to_user);
    const amount = parseFloat(row.amount);
    // from_user paid to_user, so from_user's debt goes down, to_user's credit goes down
    if (net[fromUser] !== undefined) net[fromUser].net += amount;
    if (net[toUser] !== undefined) net[toUser].net -= amount;
  });

  // Simplify: who pays whom
  const debtors = [];
  const creditors = [];

  Object.values(net).forEach(function(u) {
    if (u.net < -0.01) debtors.push({ id: u.id, name: u.name, avatar_color: u.avatar_color, net: Math.abs(u.net) });
    else if (u.net > 0.01) creditors.push({ id: u.id, name: u.name, avatar_color: u.avatar_color, net: u.net });
  });

  debtors.sort(function(a, b) { return b.net - a.net; });
  creditors.sort(function(a, b) { return b.net - a.net; });

  const transactions = [];
  var i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    var amount = Math.min(debtors[i].net, creditors[j].net);
    if (amount > 0.01) {
      transactions.push({
        from: debtors[i],
        to: creditors[j],
        amount: Math.round(amount * 100) / 100
      });
    }
    debtors[i].net -= amount;
    creditors[j].net -= amount;
    if (debtors[i].net < 0.01) i++;
    if (creditors[j].net < 0.01) j++;
  }

  return { net: Object.values(net), transactions: transactions };
}

module.exports = router;
