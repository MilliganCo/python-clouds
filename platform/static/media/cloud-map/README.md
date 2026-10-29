# Облака карты

`cloud-atlas.png` — прозрачный PNG 1536×1024, шесть вариантов в сетке 3×2.
Создан встроенным image_gen 2026-09-28 для этой платформы; не внешняя фотография.
Исходный alpha-канал сохранён, изображение не редактировалось после генерации.
Используется в `topic-map.css` через background-position, без JS-нарезки.
Подписи и состояния рисуются HTML поверх и не встроены в картинку.
С 2026-09-29 атлас — только резерв для облаков заданий при недоступном WebGL.
В фоне карты растровых облаков нет. Основные и дальние облака — процедурные
3D-модели в `static/cloud-models.js`, не этот PNG.

Путь `media/`, а не `assets/`: корневой `/assets/*` занят роутом React.

## Промпт генерации

Use case: stylized-concept. Asset type: one transparent sprite atlas for an elegant 2.5D learning map in a web app called Python in the clouds. Create a single landscape 1536x1024 image, precisely arranged as 3 equal columns by 2 equal rows. Each of the six cells must contain ONE different isolated realistic volumetric cumulus cloud, centered in its cell with generous fully transparent margins. These will be cropped by CSS into six interchangeable cloud sprites: nothing may cross a cell boundary. Six genuinely distinct organic silhouettes: wide low wispy cluster, tall asymmetric billowing cluster, rounded dense cluster, stretched layered cluster, twin peaked cloud, broad cluster with delicate trailing wisps. Each cloud fills roughly 85 percent of cell width and 70 percent of cell height. Viewpoint slightly from above and in front, natural soft sunlight from upper left, pearly white illuminated top, cool powder-blue/lavender internal shadows and underside. Material is delicate translucent water vapor with fine airy edges, rich natural volume, convincing depth, NOT plastic, NOT solid flat-bottom platforms, NOT cartoon vector symbols, NOT identical circles. Premium atmospheric game environment art, realistically rendered clouds, crisp enough at 200px displayed width. The SIX clouds are fully isolated cutouts on genuine transparent alpha, including between cells, with soft partially transparent feathered edges. No sky, no background color, no ground, no cast ground shadow, no grid lines, no text, no letters, no numbers, no border, no watermark. Keep their lighting consistent, shape and internal billows varied.
