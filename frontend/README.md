# ADUalign - Interactive ADU Designer & Map 🗺️

The frontend for ADUalign, built with Next.js and Mapbox. It allows users to search for properties, visualize buildable zones, and interactively design ADU placements with real-time zoning validation.

## 🛠 Tech Stack

- **Framework:** [Next.js 14](https://nextjs.org/) (App Router)
- **Package Manager:** [pnpm](https://pnpm.io/)
- **Mapping:** [Mapbox GL JS](https://www.mapbox.com/mapbox-gl-js), [React Map GL](http://visgl.github.io/react-map-gl/)
- **Geometry:** [@turf/turf](https://turfjs.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/), [Lucide React](https://lucide.dev/)

## 🚀 Getting Started

### 1. Prerequisites

- Node.js 18+
- `pnpm` installed (`npm install -g pnpm`)

### 2. Setup Environment

```bash
# Install dependencies
pnpm install

# Configure environment variables (fill in real values; see comments inside)
cp .env.example .env.local
```
