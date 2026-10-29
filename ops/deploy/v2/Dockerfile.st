FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
RUN apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=0 update \
    && apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=0 install -y --no-install-recommends git ca-certificates python3 openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/vc
COPY integrations/sillytavern/upstream.lock.json integrations/sillytavern/vendor.lock.json integrations/sillytavern/package.json ./integrations/sillytavern/
COPY integrations/sillytavern/scripts ./integrations/sillytavern/scripts
COPY integrations/sillytavern/patches ./integrations/sillytavern/patches
COPY integrations/sillytavern/server-plugin ./integrations/sillytavern/server-plugin
COPY integrations/sillytavern/extension ./integrations/sillytavern/extension
COPY integrations/sillytavern/memorycore-service ./integrations/sillytavern/memorycore-service
COPY infra/db/backup/vc_aead.py ./infra/db/backup/vc_aead.py
# Supply clean shallow clones at the commits in upstream.lock.json. Bootstrap
# verifies their Git state and every locked artifact before installing anything.
COPY integrations/sillytavern/upstream ./integrations/sillytavern/upstream
RUN VC_ST_DEV_DIR=/srv/vc-native node integrations/sillytavern/scripts/bootstrap.mjs \
    && VC_ST_DEV_DIR=/srv/vc-managed VC_ST_VENDOR_CACHE=/srv/vc-native/vendor-cache node integrations/sillytavern/scripts/assemble-managed.mjs
ARG VC_PUBLIC_HOST
RUN test -n "$VC_PUBLIC_HOST" && node --input-type=module <<'NODE'
import fs from 'node:fs';
const file='/srv/vc-managed/config.yaml';
const c=JSON.parse(fs.readFileSync(file));
c.logging.enableAccessLog=false;
c.hostWhitelist={enabled:true,scan:false,hosts:[process.env.VC_PUBLIC_HOST]};
fs.writeFileSync(file,JSON.stringify(c,null,2)+'\n',{mode:0o600});
NODE
RUN chown -R node:node /srv/vc-managed /opt/vc/integrations/sillytavern/upstream/SillyTavern/node_modules
COPY integrations/sillytavern/package.json integrations/sillytavern/package-lock.json /srv/
RUN npm ci --prefix /srv --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
USER node
ENV NODE_ENV=production
ENTRYPOINT ["/bin/sh", "-c", "umask 077; exec \"$@\"", "--"]
CMD ["node", "/srv/vc-managed/st-run/server.js"]
