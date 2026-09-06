# Regla para quien redacta los anuncios

**El cuerpo del anuncio TIENE que nombrar el producto con una de sus
`palabras_clave` del catálogo.**

No es una preferencia de estilo. Es lo que decide si el cliente recibe la
ficha, y ahora también si el agente de comentarios puede contestarle.

---

## Qué se rompe cuando no se cumple

Ya costaba dinero antes del agente de Facebook. Desde el 31/8 el filtro de agua
y la mascarilla se quedaron sin ficha porque su anuncio ponía el producto en un
**emoji** («Hola 👋 Me interesa 💧») y `normalizar()` borra los emojis. El
cliente recibía el texto pero **nunca la foto de la ficha**, y no hay ningún
error que lo avise.

Con el agente de comentarios se suma lo segundo: un anuncio cuyo cuerpo no
nombra el producto **no se puede mapear**, así que sus comentarios no se
contestan. Y son comentarios de gente preguntando el precio.

## Lo que hay hoy, medido el 6/9/2026

De 193 anuncios, **73 no se pueden mapear**: 325 comentarios sin atender.

| Causa | Anuncios | Comentarios |
|---|---|---|
| El cuerpo **no nombra** el producto | 72 | 249 |
| El anuncio **no tiene cuerpo** | 1 | 76 |

El del cuerpo vacío es `ADCREATIVE_01`, y él solo se lleva **76 comentarios**.

### Los cuerpos que fallan, por volumen

```
24 anuncios · 164 coment · «¿Te han hablado de operar el túnel carpiano…»
 4 anuncios ·  40 coment · «¿Te despiertas con la mano dormida, hormigueo…»
 3 anuncios ·  29 coment · «🐶🐱 Tu mascota te encanta. Encontrar sus pelos…»
 5 anuncios ·   6 coment · «🔥 QUEDAN POCAS UNIDADES: hasta 70% de descuento…»
 1 anuncio  ·   2 coment · «⭐ 4,8/5 y más de 180 reseñas verificadas…»
 1 anuncio  ·   1 coment · «🧐 "Probé 5 masajeadores para el túnel carpiano…»
```

Son copys buenos. El problema no es que estén mal escritos: es que están
escritos **solo en beneficios**, y el producto nunca aparece por su nombre.

⚠️ Ojo con el grupo del **túnel carpiano** (28 anuncios, 204 comentarios): ese
producto **no parece estar en el catálogo**. Eso no lo arregla la redacción; hay
que darlo de alta en el Sheet con sus `palabras_clave`, o el agente nunca podrá
atenderlo.

---

## La regla, en una línea

> En algún punto del cuerpo, escribe el nombre del producto tal y como aparece
> en la columna `palabras_clave` del catálogo. En texto. Nunca solo en un emoji.

### Cómo se arreglan los de arriba

| Copy actual | Qué le falta |
|---|---|
| «¿Te despiertas con la mano dormida…» | …*con la* **muñequera** *…* |
| «🐶🐱 Tu mascota te encanta…» | …*con la* **aspiradora de mano** *…* |
| «🔥 QUEDAN POCAS UNIDADES…» | el nombre del producto, que ahí no está |

No hace falta cambiar el gancho. Basta una frase en el cuerpo. Los anuncios que
ya funcionan lo hacen sin esfuerzo: «Con el **Aspirador y Soplador Inalámbrico
de Mano**…», «El **Soporte Inteligente 360° con Carga Inalámbrica**…».

### Y para el que revisa

Antes de publicar un anuncio, una comprobación de diez segundos: **busca en el
cuerpo una palabra de la columna `palabras_clave` de ese producto.** Si no está,
el anuncio se publica igual, no falla nada visible, y pierdes la ficha y los
comentarios.

---

## Nota sobre la lista

`fb/anuncios-sin-producto.csv` tiene los 73, ordenados por comentarios
perdidos, con el `ad_id`, la página, el nombre del anuncio y las primeras
palabras del cuerpo.

Son **73 y no 78** porque el export del Sheet llegó truncado y se perdieron las
5 últimas filas de `FB_Anuncios`. Están en `fb/FB_Anuncios.tsv`, que es la
lista completa de 198.
