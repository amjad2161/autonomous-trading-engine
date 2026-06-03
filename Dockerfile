# =============================================================================
# Dashboard image — build the PWA and serve it as static files.
# The Supabase backend runs separately via `supabase start` (its own Docker).
# Build with your VITE_* values baked in (they are public by design):
#   docker build --build-arg VITE_SUPABASE_URL=http://127.0.0.1:54321 ... -t trading-dashboard .
# =============================================================================

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_* are read at build time. Pass them as build args (all PUBLIC values —
# never a Gate.io key here).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_FUNCTION_SECRET
ARG VITE_SPLINE_SCENE_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
