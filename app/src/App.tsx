import { lazy, Suspense } from 'react';

// Dev-only: the design's original logic (with its mock data) rendered through the converted components, for visual parity
// checks during the port. `import.meta.env.DEV` is false in production builds, so this code and its mocks are never shipped.
const DesignPreview = import.meta.env.DEV ? lazy(() => import('./design/preview/DesignPreview')) : null;

export function App() {
  if (DesignPreview) {
    return (
      <Suspense fallback={null}>
        <DesignPreview />
      </Suspense>
    );
  }
  return null;
}
