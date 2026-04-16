const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6'];

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/groups');
  res.render('auth/login');
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) { req.flash('error', 'No account found with that email'); return res.redirect('/auth/login'); }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) { req.flash('error', 'Incorrect password'); return res.redirect('/auth/login'); }
    req.session.user = { id: user.id, name: user.name, email: user.email, avatar_color: user.avatar_color };
    res.redirect('/groups');
  } catch (err) {
    console.error(err);
    console.error('FULL ERROR:', err.message, err.stack);
    req.flash('error', 'Login failedz:'+ err.message);
    res.redirect('/auth/login');
  }
});

// GET /auth/signup
router.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/groups');
  res.render('auth/signup');
});

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) { req.flash('error', 'All fields required'); return res.redirect('/auth/signup'); }
  if (password.length < 6) { req.flash('error', 'Password must be at least 6 characters'); return res.redirect('/auth/signup'); }
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (exists.rows.length > 0) { req.flash('error', 'Email already registered'); return res.redirect('/auth/signup'); }
    const hash = await bcrypt.hash(password, 10);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, avatar_color) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), email.trim().toLowerCase(), hash, color]
    );
    const user = result.rows[0];
    req.session.user = { id: user.id, name: user.name, email: user.email, avatar_color: user.avatar_color };
    req.flash('success', `Welcome, ${user.name}! 🎉`);
    res.redirect('/groups');
  } catch (err) {
    console.error(err);
    console.error('FULL ERROR:', err.message, err.stack);
    req.flash('error', 'Signup failed:' +err.message);
    res.redirect('/auth/signup');
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
