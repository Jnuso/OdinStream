FROM caddy:2.11 AS proxy
FROM python:3.12-slim

WORKDIR /app
COPY --from=proxy /usr/bin/caddy /usr/local/bin/caddy
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY tests/load-balancing/Caddyfile.render ./Caddyfile
COPY tests/load-balancing/start-render.sh ./start-render.sh

ENTRYPOINT ["bash", "./start-render.sh"]
