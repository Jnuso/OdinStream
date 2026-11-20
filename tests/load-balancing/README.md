# Odin Stream load-balancing lab

The lab runs two copies of the real FastAPI app and a Caddy reverse proxy on your Windows machine. Caddy listens on loopback port 8080 and balances requests across API processes on ports 8001 and 8002. No hosted DNS or database is needed for the routing experiment.

## Run the failover experiment

Set up `backend/.venv` with the backend dependencies and [install Caddy](https://caddyserver.com/docs/install). From the repository root in PowerShell:

```powershell
.\tests\load-balancing\run.ps1
```

Use `-Caddy 'C:\path\to\caddy.exe'` if Caddy is outside your PATH. The script starts both backends and Caddy, measures direct and balanced `/health` calls, stops B, observes the transition to A, restarts B, verifies both receive traffic again, and stops the processes it started. The report shows counts by backend and HTTP status, plus median and p95 for successful requests. Status 0 means no HTTP response. A brief failure during the failover window is possible while Caddy's health check catches up. Latency is from the local client, so expect different results with a hosted proxy and backends.

## Try the app through the balancer

In the first PowerShell window, run `.\tests\load-balancing\run.ps1 -Serve`. In a second window, start the existing Vite frontend:

```powershell
cd frontend
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8080'
npm run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`. The browser downloads the frontend from Vite. React sends API requests to Caddy, which forwards each request to a healthy backend. In the browser's Network panel, inspect the API response's `X-Backend-Instance` header to see the backend port. Stop the lab and Vite with Ctrl+C.

For catalog and signed-in features, set the usual staging environment variables before starting the lab. Both API processes inherit the same variables from the shell. Use staging database credentials and refer to the frontend and backend READMEs for the Supabase and TMDB setup. If you override `CORS_ORIGINS`, include `http://localhost:5173`.

## Hosted equivalent

Host a staging load balancer with HTTPS and point a dedicated API DNS hostname at it. Put both staging API replicas behind it, allow the staging frontend origin in both replicas' CORS settings, and rebuild the staging frontend with that API hostname as `VITE_API_BASE_URL`. DNS directs the browser to the balancer. The balancer selects the replica. The local lab measures worker failover and does not exercise public DNS lookup, TTL, or a multi-region cutover.

The routing probe calls `/health` only. A future quota experiment can use a mock TMDB endpoint with a small quota to compare upstream request counts with per-process and shared caches.
