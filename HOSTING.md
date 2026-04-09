# Hosting London Run Tracker

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
