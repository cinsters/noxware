import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SPEC_PATH = path.join(__dirname, '..', '..', 'docs', 'openapi.yaml')

const SPEC_PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Noxware API — OpenAPI</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.addEventListener('load', () => {
        window.ui = SwaggerUIBundle({ url: '/docs/openapi.yaml', dom_id: '#swagger' })
      })
    </script>
  </body>
</html>
`

export function mountDocs(app) {
  app.get('/docs', (_req, res) => {
    res.type('html').send(SPEC_PAGE)
  })

  app.get('/docs/openapi.yaml', (_req, res) => {
    try {
      res.type('yaml').send(fs.readFileSync(SPEC_PATH, 'utf8'))
    } catch {
      res.status(404).json({ error: 'openapi.yaml not found' })
    }
  })
}
