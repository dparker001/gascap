# Use Node 22 LTS (22.12+ required by Prisma 7)
# node:22-alpine tracks the latest 22.x, which satisfies ^22.12
FROM node:22-alpine

# openssl + libc6-compat needed by some native packages
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy everything (secrets excluded via .dockerignore)
COPY . .

# Install deps — triggers postinstall: prisma generate
RUN npm ci

# Build Next.js app
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Railway injects PORT; package.json start script uses ${PORT:-3000}
CMD npm start
