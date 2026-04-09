# Hosting London Run Tracker

## Option 1: Access on your phone via local network (easiest)

Your Mac and phone must be on the same Wi-Fi network.

**1. Find your Mac's local IP address**
```bash
ipconfig getifaddr en0
# e.g. 192.168.1.42
```

**2. Update `vite.config.js`** to allow connections from other devices — add `host: true`:
```js
server: {
  host: true,   // ← add this line
  port: 5173,
  ...
}
```

**3. Start the app as normal**
```bash
npm run dev
```

**4. On your phone**, open:
```
http://192.168.1.42:5173
```

> Your phone and Mac must stay on the same Wi-Fi. Works great at home.

---

## Option 2: Expose publicly via Cloudflare Tunnel (free, no port forwarding)

This gives you a permanent HTTPS URL you can access from anywhere — including mobile data.

**1. Install cloudflared**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**2. Start the app**
```bash
npm run dev
```

**3. In a second terminal, create a quick tunnel**
```bash
cloudflared tunnel --url http://localhost:5173
```

It will print a URL like `https://random-words.trycloudflare.com` — open that on any device.

> This is a temporary tunnel (URL changes each time). For a permanent URL, set up a named tunnel at dash.cloudflare.com (free with a Cloudflare account).

---

## Option 3: ngrok (alternative to Cloudflare)

```bash
brew install ngrok
ngrok http 5173
```

Opens a public HTTPS URL valid for a few hours on the free plan.

---

## Option 4: Build and serve as a static site on your Mac

For a faster, more stable local experience (no Vite dev server overhead):

```bash
# Build the frontend
npm run build

# The Express server already serves the built files from /dist
# Just run the API directly:
PORT=3001 node server/index.js
```

Then access at `http://localhost:3001` (or your Mac's IP on port 3001 from other devices).

> This is the recommended setup for daily use — one process, faster page loads.

---

## Option 5: Run as a background service (always-on)

Use `pm2` to keep the app running even after you close the terminal:

```bash
npm install -g pm2

# Build frontend first
npm run build

# Start the server
pm2 start server/index.js --name london-run-tracker -- --env PORT=3001

# Auto-start on Mac login
pm2 startup
pm2 save
```

Then access at `http://localhost:3001` or via your Mac's IP from any device on your network.

Stop/restart with:
```bash
pm2 stop london-run-tracker
pm2 restart london-run-tracker
pm2 logs london-run-tracker
```

---

## Add to iPhone home screen

Once you have a URL (local IP or Cloudflare):

1. Open the URL in **Safari** on your iPhone
2. Tap the **Share** button (box with arrow)
3. Tap **Add to Home Screen**
4. Tap **Add**

The app will open full-screen like a native app.

---

## Environment variables

Make sure your `.env` file is present with your Strava credentials:
```
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
```

If accessing from a non-localhost URL, update the redirect URI in `server/strava.js`:
```js
const REDIRECT_URI = 'http://YOUR_IP_OR_DOMAIN/api/auth/callback';
```
And update your Strava app's **Authorization Callback Domain** at strava.com/settings/api.
