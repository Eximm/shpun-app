FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS build

WORKDIR /app

# --- Vite build-time env (from docker build args) ---
ARG VITE_TG_BOT_USERNAME
ARG VITE_TG_APP_SHORTNAME
ARG VITE_TG_STARTAPP
ARG VITE_API_BASE
ARG VITE_VAPID_PUBLIC_KEY

# Vite читает import.meta.env.* только во время build
ENV VITE_TG_BOT_USERNAME=${VITE_TG_BOT_USERNAME}
ENV VITE_TG_APP_SHORTNAME=${VITE_TG_APP_SHORTNAME}
ENV VITE_TG_STARTAPP=${VITE_TG_STARTAPP}
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}

COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM nginx:alpine@sha256:62ff2089abf5a9ed33bd232895bef5e22f7bb4b200675cec49a5ebc48e3d4ac8

# ВАЖНО: копируем весь dist, включая sw.mjs и manifest.webmanifest
COPY --from=build /app/dist/ /usr/share/nginx/html/

# nginx конфиг лежит в web/nginx.conf (внутри контекста это просто nginx.conf)
COPY nginx.conf /etc/nginx/conf.d/default.conf
