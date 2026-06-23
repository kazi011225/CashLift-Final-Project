require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Donation = require('./models/Donation');
const { generateImpactText } = require('./services/gemini');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Database connection ----------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

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

// ---------- Auth guard ----------
// Use this on any route that should only be reachable when logged in.
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/signin');
  }
  next();
}

// The causes a user can pick from when logging a donation
const CAUSES = [
  'Clean Water',
  'Hunger Relief',
  'Education',
  'Healthcare Access',
  'Disaster Relief'
];

// ---------- Routes ----------

app.get('/', (req, res) => {
  res.render('index', { user: req.session.user || null });
});

app.get('/signup', (req, res) => {
  res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if someone already signed up with this email
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.render('signup', { error: 'An account with that email already exists.' });
    }

    // Never store the raw password - only the hash
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({ username, email, passwordHash });

    // Log them in right away by saving their info in the session
    req.session.user = { id: newUser._id, username: newUser.username, email: newUser.email };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Signup error:', err);
    res.render('signup', { error: 'Something went wrong. Please try again.' });
  }
});

app.get('/signin', (req, res) => {
  res.render('signin', { error: null });
});

app.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.render('signin', { error: 'Incorrect email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.render('signin', { error: 'Incorrect email or password.' });
    }

    req.session.user = { id: user._id, username: user.username, email: user.email };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Signin error:', err);
    res.render('signin', { error: 'Something went wrong. Please try again.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const donations = await Donation.find({ userId: req.session.user.id }).sort({ createdAt: -1 });
    res.render('dashboard', { user: req.session.user, causes: CAUSES, donations, error: null });
  } catch (err) {
    console.error('Dashboard load error:', err);
    res.render('dashboard', { user: req.session.user, causes: CAUSES, donations: [], error: 'Could not load your donations.' });
  }
});

app.post('/dashboard/donate', requireAuth, async (req, res) => {
  try {
    const { cause, amount } = req.body;
    const numericAmount = Number(amount);

    // Ask Gemini to explain the real-world impact of this donation.
    // If this fails for any reason, we still save the donation -
    // impactText just stays null and the dashboard shows "coming soon".
    const impactText = await generateImpactText(cause, numericAmount);

    await Donation.create({
      userId: req.session.user.id,
      cause,
      amount: numericAmount,
      impactText
    });

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Donate error:', err);
    const donations = await Donation.find({ userId: req.session.user.id }).sort({ createdAt: -1 });
    res.render('dashboard', { user: req.session.user, causes: CAUSES, donations, error: 'Could not save your donation. Please try again.' });
  }
});

app.post('/dashboard/donate/:id/edit', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const numericAmount = Number(amount);

    // The userId filter here is what stops someone from editing a
    // donation that isn't theirs, even if they guessed another id.
    const donation = await Donation.findOne({ _id: req.params.id, userId: req.session.user.id });

    if (!donation) {
      const donations = await Donation.find({ userId: req.session.user.id }).sort({ createdAt: -1 });
      return res.render('dashboard', { user: req.session.user, causes: CAUSES, donations, error: 'Donation not found.' });
    }

    // The amount changed, so the old impact text no longer matches -
    // ask Gemini to regenerate it for the new amount.
    donation.amount = numericAmount;
    donation.impactText = await generateImpactText(donation.cause, numericAmount);
    await donation.save();

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Edit donation error:', err);
    const donations = await Donation.find({ userId: req.session.user.id }).sort({ createdAt: -1 });
    res.render('dashboard', { user: req.session.user, causes: CAUSES, donations, error: 'Could not update that donation. Please try again.' });
  }
});

app.post('/dashboard/donate/:id/delete', requireAuth, async (req, res) => {
  try {
    // Same ownership check as edit - only delete if it belongs to this user.
    await Donation.findOneAndDelete({ _id: req.params.id, userId: req.session.user.id });
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete donation error:', err);
    const donations = await Donation.find({ userId: req.session.user.id }).sort({ createdAt: -1 });
    res.render('dashboard', { user: req.session.user, causes: CAUSES, donations, error: 'Could not delete that donation. Please try again.' });
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`CashLift running at http://localhost:${PORT}`);
});