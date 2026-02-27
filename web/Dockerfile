FROM node:22-alpine AS build

# --- Vite build-time env (from docker build args) ---
ARG VITE_TG_BOT_USERNAME
ARG VITE_TG_APP_SHORTNAME
ARG VITE_TG_STARTAPP
ARG VITE_VAPID_PUBLIC_KEY

ENV VITE_TG_BOT_USERNAME=${VITE_TG_BOT_USERNAME}
ENV VITE_TG_APP_SHORTNAME=${VITE_TG_APP_SHORTNAME}
ENV VITE_TG_STARTAPP=${VITE_TG_STARTAPP}
ENV VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}

# Билдим именно фронт
WORKDIR /app/web

# зависимости фронта
COPY web/package*.json ./
RUN npm ci

# исходники фронта
COPY web/ ./

# build
RUN npm run build

# ------------------------------------------------------

FROM nginx:alpine

COPY --from=build /app/web/dist/ /usr/share/nginx/html/

COPY web/nginx.conf /etc/nginx/conf.d/default.conf