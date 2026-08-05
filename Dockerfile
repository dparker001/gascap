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

# NEXT_PUBLIC_* vars must be present during `next build` — Next.js inlines
# them into the client bundle at build time, not read at runtime. Without
# explicit ARG/ENV here, `next build` sees them as undefined even though
# they're correctly configured as Railway service variables (confirmed via
# a live bundle showing NEXT_PUBLIC_ONESIGNAL_APP_ID was never inlined,
# which silently broke Android push registration entirely, and could
# equally have broken NEXT_PUBLIC_REVENUECAT_ANDROID_KEY since it has no
# hardcoded fallback the way the iOS key does).
ARG NEXT_PUBLIC_ONESIGNAL_APP_ID
ARG NEXT_PUBLIC_REVENUECAT_IOS_KEY
ARG NEXT_PUBLIC_REVENUECAT_ANDROID_KEY
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ARG NEXT_PUBLIC_GOOGLE_ADS_ID
ARG NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL
ARG NEXT_PUBLIC_ADSENSE_PUBLISHER_ID
ARG NEXT_PUBLIC_ADSENSE_SLOT_ID
ARG NEXT_PUBLIC_GASCAPTAINS_URL
ENV NEXT_PUBLIC_ONESIGNAL_APP_ID=$NEXT_PUBLIC_ONESIGNAL_APP_ID
ENV NEXT_PUBLIC_REVENUECAT_IOS_KEY=$NEXT_PUBLIC_REVENUECAT_IOS_KEY
ENV NEXT_PUBLIC_REVENUECAT_ANDROID_KEY=$NEXT_PUBLIC_REVENUECAT_ANDROID_KEY
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_GOOGLE_ADS_ID=$NEXT_PUBLIC_GOOGLE_ADS_ID
ENV NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL=$NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL
ENV NEXT_PUBLIC_ADSENSE_PUBLISHER_ID=$NEXT_PUBLIC_ADSENSE_PUBLISHER_ID
ENV NEXT_PUBLIC_ADSENSE_SLOT_ID=$NEXT_PUBLIC_ADSENSE_SLOT_ID
ENV NEXT_PUBLIC_GASCAPTAINS_URL=$NEXT_PUBLIC_GASCAPTAINS_URL

# Build Next.js app
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Railway injects PORT; package.json start script uses ${PORT:-3000}
CMD npm start
