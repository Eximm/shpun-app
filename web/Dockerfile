FROM node:22-alpine AS build

WORKDIR /app

# --- Vite build-time env (from docker build args) ---
ARG VITE_TG_BOT_USERNAME
ARG VITE_TG_APP_SHORTNAME
ARG VITE_TG_STARTAPP

# Vite читает import.meta.env.* только во время build,
# поэтому пробрасываем в ENV до npm run build
ENV VITE_TG_BOT_USERNAME=${VITE_TG_BOT_USERNAME}
ENV VITE_TG_APP_SHORTNAME=${VITE_TG_APP_SHORTNAME}
ENV VITE_TG_STARTAPP=${VITE_TG_STARTAPP}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
