# Hosting London Run Tracker

## Cloud hosting — Railway (recommended, git-push auto-deploy)

Railway is the closest equivalent to Vercel for a full-stack Node.js app: connect your GitHub repo, push code, it deploys automatically. Free tier gives **$5/month credit** — this app uses ~$0.50–1.50/month at idle, so it should run indefinitely on the free tier.

### One-time setup

**1. Push your code to GitHub** (if not already done)
```bash
cd /Users/gingelo/Desktop/code/london-run-tracker
git remote add origin https://github.com/YOUR_USERNAME/london-run-tracker.git
git push -u origin main
```

**2. Create a Railway account**

Go to [railway.app](https://railway.app) and sign up with GitHub.

**3. New project → Deploy from GitHub repo**

- Click **New Project** → **Deploy from GitHub repo**
- Select your `london-run-tracker` repo
- Railway will detect the `Dockerfile` and start building

**4. Add a persistent volume for the database**

In your Railway project:
- Click **+ Add a Service** → **Volume**
- Set **Mount Path**: `/data`
- This persists your SQLite database across deploys

**5. Set environment variables**

In your Railway service → **Variables** tab, add:
```
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REDIRECT_URI=https://YOUR-APP.railway.app/api/auth/callback
DB_PATH=/data/london-runs.db
PORT=3001
```

Railway automatically sets a public domain like `london-run-tracker-production.up.railway.app`. Copy it from the **Settings** tab.

**6. Update your Strava API settings**

Go to [strava.com/settings/api](https://www.strava.com/settings/api) and set:
- **Authorization Callback Domain**: `YOUR-APP.railway.app`

**7. That's it — deploys happen automatically on every `git push`**

```bash
git push  # → Railway builds and deploys in ~2 minutes
```

---

### Subsequent deploys

```bash
git add .
git commit -m "your changes"
git push  # Railway auto-deploys
```

Your database on `/data` is preserved across deploys.

---

### Upload your existing database

```bash
# Install Railway CLI
brew install railway

# Login
railway login

# Upload your local DB
railway run --service london-run-tracker \
  scp london-runs.db /data/london-runs.db
```

Or use the Railway dashboard file browser if available.

---

### Useful Railway commands

```bash
railway logs          # Live logs
railway status        # App health
railway open          # Open in browser
railway variables     # List env vars
```

---

### Free tier limits

Railway free tier (as of 2025):
- $5/month credit — typically lasts all month for a small personal app
- 512MB RAM, shared CPU
- 100GB outbound data/month
- App stays running 24/7 (unlike Vercel which kills serverless after 10–60s)

> **Why not Vercel?** Vercel's serverless functions time out at 10–60s. A full London sync takes 8+ minutes. Railway runs a real Node.js process with no timeout limits.

---

## Cloud hosting — Fly.io (recommended, free)

Fly.io gives you a permanent HTTPS URL accessible from any device, with a **persistent volume** so your SQLite database (activities, coverage data) survives restarts and redeploys. No credit card required for a single small app.

### One-time setup

**1. Install the Fly CLI**
```bash
brew install flyctl
```

**2. Sign up (free)**
```bash
fly auth signup
# or if you have an account:
fly auth login
```

**3. Create the app** (run once from the project directory)
```bash
cd /Users/gingelo/Desktop/code/london-run-tracker
fly apps create london-run-tracker
```
> If `london-run-tracker` is taken, pick another name — it becomes your URL.

**4. Create a persistent volume for the database** (3GB, free tier)
```bash
fly volumes create london_run_data --region lhr --size 3
```

**5. Set your Strava credentials as secrets**
```bash
fly secrets set \
  STRAVA_CLIENT_ID=your_client_id \
  STRAVA_CLIENT_SECRET=your_client_secret \
  STRAVA_REDIRECT_URI=https://london-run-tracker.fly.dev/api/auth/callback
```
Replace `london-run-tracker` with your actual app name if different.

**6. Update your Strava API settings**

Go to [strava.com/settings/api](https://www.strava.com/settings/api) and set:
- **Authorization Callback Domain**: `london-run-tracker.fly.dev`

**7. Deploy**
```bash
fly deploy
```

This builds the Docker image, pushes it, and starts the app. Takes ~2 minutes.

**8. Open the app**
```bash
fly open
# or visit: https://london-run-tracker.fly.dev
```

Add it to your iPhone home screen via Safari → Share → Add to Home Screen for a full-screen app experience.

---

### Subsequent deploys

After making code changes:
```bash
fly deploy
```

Your database on `/data` is preserved across deploys.

---

### Upload your existing database

Your local SQLite database has all your existing activity and coverage data. Upload it to avoid re-syncing from scratch:

```bash
# Stop the running app temporarily
fly machine stop

# Copy your local DB to the volume
fly sftp shell
# Then in the sftp shell:
put london-runs.db /data/london-runs.db
exit

# Restart
fly machine start
```

Or use the simpler one-liner if you have `flyctl` >= 0.2:
```bash
fly ssh sftp put london-runs.db /data/london-runs.db
```

---

### Useful commands

```bash
fly status              # Check app health
fly logs                # Live server logs
fly ssh console         # SSH into the running machine
fly volumes list        # Check volume status
fly secrets list        # List set secrets (values hidden)
```

---

### Free tier limits

Fly.io free tier (as of 2025) includes:
- 3 shared-CPU VMs (your app uses 1)
- 3GB persistent storage
- 160GB outbound data/month
- Automatic sleep when idle, instant wake on request

This app is well within the free limits for personal use.

---

## Local network access (quick, no account needed)

For access on your phone at home:

**1. Start the app**
```bash
npm run dev
```

Vite will print something like:
```
  ➜  Network: http://192.168.1.42:5173/
```

**2. Open that URL on your phone** (must be on same Wi-Fi)

**3. Add to home screen** in Safari: Share → Add to Home Screen

---

## Temporary public URL (no sign-up)

For quick sharing or testing on mobile data:

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Start app, then in another terminal:
cloudflared tunnel --url http://localhost:5173
```

Prints a public HTTPS URL — valid until you stop the command.
