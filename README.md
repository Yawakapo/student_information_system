# Student Information System

## Run locally

1. Install dependencies:

   ```powershell
   npm.cmd ci
   ```

2. Configure the server. Copy `.env.example` to `server/.env` (or provide the same variables through the process environment). Keep real credentials out of source control.

3. Create or update the MySQL schema:

   ```powershell
   npm.cmd run db:migrate
   ```

4. Start the server:

   ```powershell
   npm.cmd start
   ```

5. Open [http://localhost:5000/](http://localhost:5000/).

The health endpoint is available at `GET /api/health`.

## Sharing the site with someone on another network

The server accepts requests from any hostname it is reached by, so a tunnel works without extra configuration. The client also treats a portless public URL as its own origin, so no code change is needed.

The two libraries the pages need at runtime are served by this server rather than a public CDN, so a user on a different network is not blocked by an outside host:

| Library | Served from | Used for |
| --- | --- | --- |
| Socket.IO client | `/socket.io/socket.io.min.js` | Live updates when data changes |
| SheetJS (xlsx) | `/vendor/xlsx.full.min.js` | Importing and exporting student lists |

Both already ship with the project, so this needs no extra installation. The school logo is likewise stored in the project at `Profile pic_part/Arellano_University_New_Logo.png`, so no page contacts the school website to draw it.

The only remaining outside requests are the login-page background photo, the generated avatars, and one link to the school's website. Those are decoration, so a network that blocks them still leaves every page fully working, only the images missing.

1. Start the server, then start a tunnel in a second terminal:

   ```powershell
   # Cloudflare Tunnel (no account needed for a quick random URL)
   cloudflared tunnel --url http://localhost:5000
   ```

   ```powershell
   # or ngrok
   ngrok http 5000
   ```

2. Copy the printed `https://...` URL and send it to the person. They open it on any network, including mobile data.
3. Create their account first in **Create Account**, then give them the username and password. Only an admin can create accounts, and only an admin can open the admin pages.

To stop sharing, close the tunnel. The site stays on your machine and the public URL stops working immediately.

### How a tunnel is handled

| Concern | How the server deals with it |
| --- | --- |
| Libraries and images | Served from this server or the project folder, so a blocked outside host cannot break a page |
| Page addressing | A portless public URL is treated as this server, so no request is sent to a `:5000` address that does not exist publicly |
| Login lockout | The real visitor address is taken from the tunnel's header, so five wrong passwords lock out one person rather than everybody at once. The header is only trusted from this machine, so a direct connection cannot pretend to be a tunnel |

### Before you share a link

- The tunnel URL is reachable by **anyone who has it**. Share it only with people you trust, and send student or teacher accounts rather than the admin account.
- Login is throttled: 5 failed attempts from the same address locks that address out for 15 minutes. Adjust with `LOGIN_ATTEMPT_LIMIT` and `LOGIN_ATTEMPT_WINDOW_MS`.
- Keep `SESSION_SECRET` set in `server/process.env` so sessions survive a restart.
- Stop the tunnel when the demonstration is over.

## Notes

- The server serves only the known front-end directories; `server/` and `backend/` are not public static routes.
- Password-reset codes are short-lived, validated again during reset, and never returned in API responses.
- Set a stable, random `SESSION_SECRET` in production. If it is omitted in development, the server creates an ephemeral secret and sessions end when the process restarts.
- The business rules live in the C programs in `backend/`. Six of them answer page requests: `dashboard_counts`, `view_schedules`, `unassigned_students`, `check_schedule`, `schedule_worker` and `teachers_worker`. Node starts them and reads the JSON they print; it does not repeat their decisions.
