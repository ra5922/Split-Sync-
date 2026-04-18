const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');

router.use(requireAuth);

async function getGroupData(groupId, userId) {
  const check = await pool.query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
  if (check.rows.length === 0) return null;

  const group = await pool.query('SELECT * FROM groups WHERE id=$1', [groupId]);
  const expenses = await pool.query(`
    SELECT e.*, u.name AS paid_by_name
    FROM expenses e JOIN users u ON u.id = e.paid_by
    WHERE e.group_id = $1 ORDER BY e.created_at DESC
  `, [groupId]);

  const members = await pool.query(`
    SELECT u.id, u.name FROM users u
    JOIN group_members gm ON gm.user_id = u.id WHERE gm.group_id = $1 ORDER BY u.name
  `, [groupId]);

  // Calculate balances
  const net = {};
  members.rows.forEach(function(m) { net[m.id] = { id: m.id, name: m.name, net: 0 }; });

  const expRows = await pool.query('SELECT id, paid_by FROM expenses WHERE group_id=$1', [groupId]);
  for (const exp of expRows.rows) {
    const splits = await pool.query(
      'SELECT user_id, amount_owed FROM splits WHERE expense_id=$1',
      [exp.id]
    );
    splits.rows.forEach(function(split) {
      if (split.user_id === exp.paid_by) return;
      if (net[split.user_id]) net[split.user_id].net -= parseFloat(split.amount_owed);
      if (net[exp.paid_by]) net[exp.paid_by].net += parseFloat(split.amount_owed);
    });
  }

  // Apply settlements
  const settlements = await pool.query(
    'SELECT from_user, to_user, amount FROM settlements WHERE group_id=$1', [groupId]
  );
  settlements.rows.forEach(function(row) {
    if (net[row.from_user]) net[row.from_user].net += parseFloat(row.amount);
    if (net[row.to_user]) net[row.to_user].net -= parseFloat(row.amount);
  });

  // Simplify to transactions
  const debtors = Object.values(net).filter(u => u.net < -0.01).map(u => ({ ...u, net: Math.abs(u.net) }));
  const creditors = Object.values(net).filter(u => u.net > 0.01);
  debtors.sort((a, b) => b.net - a.net);
  creditors.sort((a, b) => b.net - a.net);

  const transactions = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].net, creditors[j].net);
    if (amount > 0.01) {
      transactions.push({ from: debtors[i].name, to: creditors[j].name, amount: Math.round(amount * 100) / 100 });
    }
    debtors[i].net -= amount;
    creditors[j].net -= amount;
    if (debtors[i].net < 0.01) i++;
    if (creditors[j].net < 0.01) j++;
  }

  return { group: group.rows[0], expenses: expenses.rows, members: members.rows, net: Object.values(net), transactions };
}

// GET /export/:groupId/csv
router.get('/:groupId/csv', async (req, res) => {
  const data = await getGroupData(req.params.groupId, req.session.user.id);
  if (!data) return res.status(403).send('Access denied');

  const rows = data.expenses.map(e => ({
    Date: new Date(e.created_at).toLocaleDateString('en-IN'),
    Description: e.description,
    Category: e.category,
    'Paid By': e.paid_by_name,
    Amount: `Rs.${parseFloat(e.amount).toFixed(2)}`,
    Discount: `Rs.${parseFloat(e.discount).toFixed(2)}`,
    'Net Amount': `Rs.${(parseFloat(e.amount) - parseFloat(e.discount)).toFixed(2)}`,
    Notes: e.notes || ''
  }));

  try {
    const parser = new Parser();
    const csv = parser.parse(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${data.group.name}-expenses.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('Export failed');
  }
});

// GET /export/:groupId/pdf
router.get('/:groupId/pdf', async (req, res) => {
  const data = await getGroupData(req.params.groupId, req.session.user.id);
  if (!data) return res.status(403).send('Access denied');

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${data.group.name}-expenses.pdf"`);
  doc.pipe(res);

  // ===== HEADER =====
  doc.rect(0, 0, 595, 80).fill('#6366f1');
  doc.fillColor('white').fontSize(22).font('Helvetica-Bold').text('SplitWise — Expense Report', 50, 22);
  doc.fontSize(11).font('Helvetica').text(`Group: ${data.group.name}  |  Category: ${data.group.category}  |  Exported: ${new Date().toLocaleDateString('en-IN')}`, 50, 52);

  // ===== SUMMARY =====
  const total = data.expenses.reduce((sum, e) => sum + parseFloat(e.amount) - parseFloat(e.discount), 0);
  doc.fillColor('#1a1a2e').fontSize(13).font('Helvetica-Bold').text('Summary', 50, 100);
  doc.fontSize(10).font('Helvetica').fillColor('#444')
    .text(`Total Expenses: ${data.expenses.length}`, 50, 118)
    .text(`Total Amount Spent: Rs.${total.toFixed(2)}`, 50, 133)
    .text(`Members: ${data.members.map(m => m.name).join(', ')}`, 50, 148);

  // ===== WHO OWES WHOM =====
  let y = 175;
  doc.fillColor('#6366f1').fontSize(13).font('Helvetica-Bold').text('Who Pays Whom', 50, y);
  y += 20;

  if (data.transactions.length === 0) {
    doc.rect(50, y, 495, 28).fill('#d1fae5');
    doc.fillColor('#065f46').fontSize(10).font('Helvetica-Bold').text('All settled up! No payments needed.', 60, y + 9);
    y += 38;
  } else {
    data.transactions.forEach(function(t) {
      doc.rect(50, y, 495, 26).fill('#eef2ff');
      doc.fillColor('#1a1a2e').fontSize(10).font('Helvetica');
      doc.text(`${t.from}`, 60, y + 8, { width: 140 });
      doc.fillColor('#6366f1').font('Helvetica-Bold').text(`pays  Rs.${t.amount.toFixed(2)}  →`, 200, y + 8, { width: 150 });
      doc.fillColor('#1a1a2e').font('Helvetica').text(`${t.to}`, 360, y + 8);
      y += 30;
    });
  }

  // ===== INDIVIDUAL BALANCES =====
  y += 10;
  doc.fillColor('#6366f1').fontSize(13).font('Helvetica-Bold').text('Individual Balances', 50, y);
  y += 20;

  doc.rect(50, y, 495, 22).fill('#f1f5f9');
  doc.fillColor('#374151').fontSize(9).font('Helvetica-Bold');
  doc.text('Member', 60, y + 7);
  doc.text('Status', 300, y + 7);
  doc.text('Amount', 450, y + 7);
  y += 26;

  data.net.forEach(function(u, idx) {
    if (y > 700) { doc.addPage(); y = 50; }
    if (idx % 2 === 0) doc.rect(50, y - 2, 495, 20).fill('#f9fafb');
    doc.fillColor('#374151').fontSize(9).font('Helvetica');
    doc.text(u.name, 60, y);
    if (u.net > 0.01) {
      doc.fillColor('#065f46').text('Gets back', 300, y);
      doc.text(`Rs.${u.net.toFixed(2)}`, 450, y);
    } else if (u.net < -0.01) {
      doc.fillColor('#991b1b').text('Owes', 300, y);
      doc.text(`Rs.${Math.abs(u.net).toFixed(2)}`, 450, y);
    } else {
      doc.fillColor('#6b7280').text('Settled', 300, y);
      doc.text('Rs.0.00', 450, y);
    }
    y += 22;
  });

  // ===== EXPENSES TABLE =====
  y += 15;
  if (y > 650) { doc.addPage(); y = 50; }
  doc.fillColor('#6366f1').fontSize(13).font('Helvetica-Bold').text('Expense History', 50, y);
  y += 20;

  doc.rect(50, y, 495, 22).fill('#6366f1');
  doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
  doc.text('Date', 55, y + 7);
  doc.text('Description', 110, y + 7);
  doc.text('Category', 250, y + 7);
  doc.text('Paid By', 330, y + 7);
  doc.text('Amount', 420, y + 7);
  doc.text('Net', 475, y + 7);
  y += 26;

  data.expenses.forEach(function(e, idx) {
    if (y > 750) { doc.addPage(); y = 50; }
    if (idx % 2 === 0) doc.rect(50, y - 2, 495, 18).fill('#f9fafb');
    doc.fillColor('#374151').fontSize(8).font('Helvetica');
    doc.text(new Date(e.created_at).toLocaleDateString('en-IN'), 55, y);
    doc.text(e.description.substring(0, 20), 110, y);
    doc.text(e.category, 250, y);
    doc.text(e.paid_by_name, 330, y);
    doc.text(`Rs.${parseFloat(e.amount).toFixed(0)}`, 420, y);
    const net = parseFloat(e.amount) - parseFloat(e.discount);
    doc.text(`Rs.${net.toFixed(0)}`, 475, y);
    y += 20;
  });

  // Total row
  if (y > 730) { doc.addPage(); y = 50; }
  doc.rect(50, y, 495, 24).fill('#6366f1');
  doc.fillColor('white').fontSize(10).font('Helvetica-Bold');
  doc.text('TOTAL', 55, y + 7);
  doc.text(`Rs.${total.toFixed(2)}`, 420, y + 7);

  doc.end();
});

module.exports = router;
