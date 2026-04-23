require('dotenv').config();
console.log('DB_HOST:', process.env.DB_HOST);
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./db');

const app = express();

// View engine
app.set('view engine', 'ejs');


// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(methodOverride('_method'));

// Session
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(flash());

// Global locals
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/groups', require('./routes/groups'));
app.use('/expenses', require('./routes/expenses'));
app.use('/export', require('./routes/export'));

// Home redirect
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/groups');
  res.redirect('/auth/login');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✨ SplitSync running on http://localhost:${PORT}`));
