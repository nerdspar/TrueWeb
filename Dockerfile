# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# adapter-node reads these at runtime, so compose env alone configures the app.
ENV PORT=8110
ENV HOST=0.0.0.0

# Unlike Seek, the runtime needs node_modules: adapter-node leaves some
# dependencies external rather than bundling them (verified — `ws` and `yaml`
# are still imported by name in build/, while bcryptjs is inlined). Copying
# only build/ would produce a container that dies on its first request.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/build ./build

USER node

EXPOSE 8110
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD node -e "fetch('http://127.0.0.1:8110/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
