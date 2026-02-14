# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# Явно копируем package.json и package-lock.json
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# В рантайме ставим только prod зависимости строго по lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Забираем только dist
COPY --from=build /app/dist ./dist

CMD ["node","dist/index.js"]
