# ---------- build stage ----------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS build
WORKDIR /app

# Явно копируем package.json и package-lock.json
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85
WORKDIR /app

RUN apk add --no-cache openssh-client

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# В рантайме ставим только prod зависимости строго по lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Забираем только dist
COPY --from=build /app/dist ./dist

CMD ["node","dist/index.js"]
