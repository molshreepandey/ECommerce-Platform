'use client';

import 'swagger-ui-dist/swagger-ui.css';
import Script from 'next/script';
import { z } from 'zod';

const swaggerGlobalSchema = z.object({
  SwaggerUIBundle: z.custom<(options: Record<string, unknown>) => unknown>(
    (value) => typeof value === 'function',
  ),
});

// D49: Swagger UI over the generated OpenAPI document. Requests from "Try it out" run on this admin
// origin with the signed-in staff session, like the admin pages themselves.
export function SwaggerDocs() {
  return (
    <>
      <div id="swagger-ui" className="rounded-default bg-white" />
      <Script
        src="/api/admin/docs/assets/swagger-ui-bundle.js"
        strategy="afterInteractive"
        onReady={() => {
          const global = swaggerGlobalSchema.safeParse(window);
          if (!global.success) return;
          global.data.SwaggerUIBundle({
            url: '/api/admin/docs/openapi.json',
            dom_id: '#swagger-ui',
            deepLinking: true,
          });
        }}
      />
    </>
  );
}
