import { useEffect } from 'react';

// =============================================================================
// SplineScene — embed a Spline 3D scene with zero build-time dependencies.
// =============================================================================
// Uses Spline's <spline-viewer> web component loaded from a CDN at runtime, so
// we don't add any npm package to the build. It renders nothing until a scene
// URL is provided (prop or VITE_SPLINE_SCENE_URL), so it is safe to mount
// anywhere and changes nothing until you wire in a real exported scene.
//
// HOW TO GET THE URL: in Spline, open the file → Export → "Viewer" / "Code",
// copy the public ".splinecode" URL (looks like
// https://prod.spline.design/<id>/scene.splinecode). The app.spline.design
// editor link is NOT usable for embedding — it is the private editor.
// =============================================================================

const VIEWER_SRC = 'https://unpkg.com/@splinetool/viewer/build/spline-viewer.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'spline-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { url?: string; 'events-target'?: string },
        HTMLElement
      >;
    }
  }
}

let scriptInjected = false;
function ensureViewerScript() {
  if (scriptInjected || typeof document === 'undefined') return;
  if (document.querySelector('script[data-spline-viewer]')) {
    scriptInjected = true;
    return;
  }
  const s = document.createElement('script');
  s.type = 'module';
  s.src = VIEWER_SRC;
  s.setAttribute('data-spline-viewer', 'true');
  document.head.appendChild(s);
  scriptInjected = true;
}

interface SplineSceneProps {
  /** Public .splinecode export URL. Falls back to VITE_SPLINE_SCENE_URL. */
  url?: string;
  className?: string;
}

export function SplineScene({ url, className }: SplineSceneProps) {
  const sceneUrl = url ?? (import.meta.env.VITE_SPLINE_SCENE_URL as string | undefined);

  useEffect(() => {
    if (sceneUrl) ensureViewerScript();
  }, [sceneUrl]);

  if (!sceneUrl) return null;

  return (
    <div className={className}>
      <spline-viewer url={sceneUrl} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
