require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- View engine setup ----------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ---------- Middleware ----------
app.use(express.urlencoded({ extended: true })); // lets us read form data from req.body
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serves /public/css/style.css etc.

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_only_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 2 } // 2 hour session
}));

// ---------- Routes ----------
// NOTE: these are placeholder renders for now. In Step 3-4 we'll connect
// MongoDB and add real signup/signin logic that checks/saves users.

app.get('/', (req, res) => {
  res.render('index', { user: req.session.user || null });
});

app.get('/signup', (req, res) => {
  res.render('signup', { error: null });
});

app.get('/signin', (req, res) => {
  res.render('signin', { error: null });
});

// We'll fill these in once MongoDB is wired up:
// app.post('/signup', ...)
// app.post('/signin', ...)
// app.get('/logout', ...)
// app.get('/dashboard', ...)
// app.post('/dashboard/donate', ...)

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`CashLift running at http://localhost:${PORT}`);
});
