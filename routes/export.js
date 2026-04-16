const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');

router.use(requireAuth);

async function getGroupExpenses(groupId, userId) {
  // Check membership
  const check = await pool.query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
  if (check.rows.length === 0) return null;

  const group = await pool.query('SELECT * FROM groups WHERE id=$1', [groupId]);
  const expenses = await pool.query(`
    SELECT e.*, u.name AS paid_by_name
    FROM expenses e JOIN users u ON u.id = e.paid_by
    WHERE e.group_id = $1 ORDER BY e.created_at DESC
  `, [groupId]);
  return { group: group.rows[0], expenses: expenses.rows };
}

// GET /export/:groupId/csv
router.get('/:groupId/csv', async (req, res) => {
  const data = await getGroupExpenses(req.params.groupId, req.session.user.id);
  if (!data) return res.status(403).send('Access denied');

  const rows = data.expenses.map(e => ({
    Date: new Date(e.created_at).toLocaleDateString('en-IN'),
    Description: e.description,
    Category: e.category,
    'Paid By': e.paid_by_name,
    Amount: `₹${parseFloat(e.amount).toFixed(2)}`,
    Discount: `₹${parseFloat(e.discount).toFixed(2)}`,
    'Net Amount': `₹${(parseFloat(e.amount) - parseFloat(e.discount)).toFixed(2)}`,
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
  const data = await getGroupExpenses(req.params.groupId, req.session.user.id);
  if (!data) return res.status(403).send('Access denied');

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${data.group.name}-expenses.pdf"`);
  doc.pipe(res);

  // Header
  doc.rect(0, 0, 595, 80).fill('#6366f1');
  doc.fillColor('white').fontSize(24).font('Helvetica-Bold').text('💸 Expense Splitter', 50, 25);
  doc.fontSize(12).font('Helvetica').text(`Group: ${data.group.name}  |  Category: ${data.group.category}`, 50, 55);

  doc.fillColor('#1e1e2e').moveDown(2);

  // Summary
  const total = data.expenses.reduce((sum, e) => sum + parseFloat(e.amount) - parseFloat(e.discount), 0);
  doc.fontSize(14).font('Helvetica-Bold').text('Summary', 50, 100);
  doc.fontSize(11).font('Helvetica')
    .text(`Total Expenses: ${data.expenses.length}`, 50, 120)
    .text(`Total Amount Spent: ₹${total.toFixed(2)}`, 50, 138)
    .text(`Exported on: ${new Date().toLocaleDateString('en-IN')}`, 50, 156);

  // Table header
  let y = 190;
  doc.rect(50, y, 495, 24).fill('#f1f5f9');
  doc.fillColor('#374151').fontSize(10).font('Helvetica-Bold');
  doc.text('Date', 55, y + 7);
  doc.text('Description', 115, y + 7);
  doc.text('Category', 260, y + 7);
  doc.text('Paid By', 340, y + 7);
  doc.text('Amount', 420, y + 7);
  doc.text('Net', 480, y + 7);

  y += 28;
  doc.font('Helvetica').fontSize(9);

  data.expenses.forEach((e, idx) => {
    if (y > 750) { doc.addPage(); y = 50; }
    if (idx % 2 === 0) doc.rect(50, y - 2, 495, 18).fill('#f9fafb');
    doc.fillColor('#374151');
    doc.text(new Date(e.created_at).toLocaleDateString('en-IN'), 55, y);
    doc.text(e.description.substring(0, 25), 115, y);
    doc.text(e.category, 260, y);
    doc.text(e.paid_by_name, 340, y);
    doc.text(`₹${parseFloat(e.amount).toFixed(0)}`, 420, y);
    const net = parseFloat(e.amount) - parseFloat(e.discount);
    doc.text(`₹${net.toFixed(0)}`, 480, y);
    y += 20;
  });

  // Total row
  doc.rect(50, y, 495, 24).fill('#6366f1');
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold');
  doc.text('TOTAL', 55, y + 7);
  doc.text(`₹${total.toFixed(2)}`, 420, y + 7);

  doc.end();
});

module.exports = router;
