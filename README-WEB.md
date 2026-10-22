# LINE OA Web Gateway

Standalone web edition of LINE OA Gateway. It does not require Home Assistant,
Home Assistant Supervisor, Ingress, or discovery services.

## Run locally

```sh
cd line_oa/app
npm ci
npm run build
npm start
```

Open `http://localhost:8787`. Persistent login credentials, contacts, aliases,
and the API key are stored in `./data` by default. To store them elsewhere, set
`DATA_DIR`. Set `PORT` and `HOST` to change the listener.

## Run with Docker

```sh
cd line_oa/app
docker build -t line-oa-web .
docker run --rm -p 8787:8787 -v line-oa-data:/data line-oa-web
```

The browser UI and API share one origin and one port:

- UI: `http://localhost:8787/`
- health check: `GET /api/v1/health`
- versioned API: `/api/v1/*`

## Create an API v1 key

The Home Assistant pairing endpoint is not used by the standalone edition.
Generate the key inside the running container so the key itself is only printed
to your terminal:

```sh
docker compose exec -T <service-name> node dist/scripts/generate-api-key.js
```

For a container started with `docker run`, use:

```sh
docker exec -it <container-name> node dist/scripts/generate-api-key.js
```

Save the output immediately. It is shown only once; the application persists
only a hash under `/data/secrets/api-key.json`. Generating a replacement key
invalidates the previous key after the gateway is restarted. Restart its
container after generating or rotating a key so the running process reloads
the stored hash.

Send it with every API v1 request:

```sh
curl http://localhost:8787/api/v1/status \
  -H "Authorization: Bearer loagw_your_key_here"
```

The original LINE service interaction is unofficial. Use a dedicated account and
keep the persistent data volume private: it contains LINE session credentials.
