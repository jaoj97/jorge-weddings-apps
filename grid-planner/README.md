# Grid Planner · Jorge Weddings

App para planear el grid de Instagram arrastrando fotos entre una galería externa y la cuadrícula 3×3 estilo Instagram.

## Modos de uso

### A) Online — https://apps.jorgeweddings.com/grid-planner/
La primera vez te pide pegar tu **Airtable PAT** (se guarda solo en este navegador, en `localStorage`). Click derecho en "Sincronizar" → cambiar/borrar PAT.

### B) Local
```bash
python3 server.py     # corre desde la carpeta grid-planner
```
Abre **http://localhost:8765**. El PAT vive en `~/.config/flow-ibs/credentials.env`, nunca toca el navegador. Análisis de paleta/luminosidad funciona sin restricciones CORS.

El servidor:
- Sirve la app estática (HTML/CSS/JS).
- Hace de proxy a Airtable inyectando el `AIRTABLE_PAT` desde `~/.config/flow-ibs/credentials.env` (la API key NUNCA se expone al navegador).
- Hace proxy de imágenes de Airtable CDN para evitar bloqueos CORS al leer pixeles (paleta + luminosidad).

## Funcionalidades

### Layout
- Galería externa **izquierda** · Grid Instagram **derecha**.
- Toggle **Perfil completo / Solo grid**.
- Tema claro / oscuro.
- Slider de zoom (5 niveles).
- Calendario lateral con cadencia configurable.

### Drag & Drop
- Arrastrar fotos entre galería ↔ grid en ambos sentidos.
- Reordenar dentro del grid (modo "push" o "swap").
- Botón **×** al hover sobre cada celda → vuelve a galería.
- Multi-select con `Shift+click`, `Delete` para sacar.
- Doble click en una foto de la galería la manda al final del planeado.
- Atajos: `⌘Z` undo · `⌘⇧Z` redo · `Esc` cierra paneles · `F` pantalla completa.

### Datos
- **Sincronizar** trae automáticamente: tabla `Carousels` (con todos sus slides como hover preview), `Stock photos`, `Historias`, `Postear` (los `published` van directo a la zona de "ya publicado").
- **Filtros** de galería: por fuente, búsqueda, tags.
- **Subir fotos manualmente** (botón o drag-drop de archivos del Finder).
- **Push a Airtable**: convierte todo lo planeado en registros de la tabla `Postear` con caption, fecha, primer comentario.

### Visualización del grid
- Overlay de **paleta dominante** (4 colores por celda).
- Overlay de **luminosidad** (heatmap de brillo).
- Detección de **fotos similares vecinas** → marca con badge "≈ similar".
- **Hover preview** sobre carruseles muestra los 8 primeros slides.
- **Divisor** entre publicado / planeado (línea de hoy).
- **Barra de balance** por tipo (foto / carrusel / reel / story).
- **Iconos** de tipo en cada celda.

### Patrones de grid (botón "Patrones")
- Tablero (alterna luz/oscuro).
- Filas temáticas, diagonales por color, puzzle 3×3 por boda.
- Invertir, ordenar por rating, ordenar por fecha de shoot, balancear pesos visuales.

### Inspector (click en una celda)
- Tipo, fecha programada, capítulo, caption, hashtags, primer comentario, ubicación, alt text, link.
- Contador de caracteres (warning > 2200).
- Pool de hashtags reusables.

### Versiones
- **Snapshots** ilimitadas con nombre — cargar o mandar a "Versión B".
- **Split view** con dos grids lado a lado para comparar.
- Undo / redo ilimitado en sesión.

### Exportar (botón "Exportar")
- 📸 Screenshot del grid (PNG).
- 📋 CSV con orden, fechas, captions, hashtags.
- 💾 JSON del proyecto completo.
- 🔗 HTML autocontenido para compartir.
- 📤 Push a Airtable (tabla Postear).
- 🖨️ Imprimir (modo print con solo el grid).

### Persistencia
- Auto-save en `localStorage` cada 400ms.
- Import / export JSON manual.

## Atajos útiles

| Tecla | Acción |
|---|---|
| `⌘Z` / `Ctrl+Z` | Deshacer |
| `⌘⇧Z` / `Ctrl+Y` | Rehacer |
| `Esc` | Cerrar paneles / cancelar selección |
| `F` | Modo presentación (pantalla completa) |
| `Delete` / `Backspace` | Sacar fotos seleccionadas del grid |
| `Shift + click` | Multi-selección |
| Doble click en foto galería | Mandar al final del planeado |

## Stack

- Backend: `python3 -m http.server` (stdlib pura, sin dependencias).
- Frontend: vanilla JS + [SortableJS](https://sortablejs.github.io/Sortable/) + [html2canvas](https://html2canvas.hertzen.com/) (CDN).
- Airtable Jorge Weddings (`appDrl2lAZc8WRXzO`).
