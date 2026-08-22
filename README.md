# dotrino-social-bot

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

El bot que publica las noticias de Dotrino. **Publica primero en [eco](https://eco.dotrino.com)**, con
el perfil de Dotrino, y después comparte en X, LinkedIn y Discord **el enlace de ese eco**: las redes
apuntan a eco, no al revés.

## Cómo es un aparato de Dotrino

El bot es un aparato más del acta del perfil de Dotrino, enrolado como **servicio `cn: eco`**
(`dotrino-vault pair --service eco`). Su certificado lleva solo `vault:secrets:eco`:

- firma sus ecos con su propia llave (como cualquier aparato de la app; `authorName: Dotrino`);
- lee **su** cajón de secretos (`BUFFER_API_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`) del vault —
  no hay `.env`;
- **no** puede firmar por el perfil, leer otros cajones ni administrar nada.

Quitarlo es revocar ese aparato en el vault.

## Qué hace en cada corrida

`dotrino-social-bot post <twitter|linkedin|discord>` — una corrida, un post:

1. elige el tópico menos publicado (ponderado por `_weights`, sin repetir el último) y el siguiente
   ítem de `content/social-content.json`;
2. **eco**: arma el eco (texto recortado a 280 por frase, la fuente en `links`, los `#tags`), lo firma,
   pone el beacon en geo (24 h, Quito) y deja la **copia pública pineada** en el node de Dotrino por
   su API local (`CONTENT_URL`, por defecto `http://127.0.0.1:3777`). El beacon es efímero; el
   enlace `https://eco.dotrino.com/#<owner>/<cid>` dura lo que el node lo sirva;
3. **la red**: en X el texto + el enlace del eco; en LinkedIn y Discord además `Fuente:`;
4. avanza el estado (`~/.local/share/dotrino/social-bot/state.json`) solo si las dos cosas pasaron.

Si eco falla no se publica nada en la red. `--dry` muestra sin publicar; `--only <topic>` fuerza tópico.

## Instalar (en la máquina del node de contenido)

```bash
git clone git@dotrino:imdotrino/dotrino-social-bot.git && cd dotrino-social-bot && npm install
# en el vault:      dotrino-vault pair --service eco   → invitación
node bin/cli.js enroll '<invitación>'                   # imprime el código → dotrino-vault approve <código>
# en el vault:      dotrino-vault secret set eco BUFFER_API_KEY=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=…
node bin/cli.js whoami && node bin/cli.js channels
node bin/cli.js post twitter --dry
```

Cron (hora de Ecuador, UTC−5): X 13:00, LinkedIn 16:00, Discord 19:00.

## Contenido

`content/social-content.json`: por red y por tópico, ítems `{ text, source }`. Reglas: solo noticias
con fuente verificable; español neutro (tuteo, sin voseo); sin emojis; X ≤ 280 contando el enlace;
nunca se nombra ni se insinúa a un antagonista. Ver `_doc` dentro del archivo.

## Licencia

MIT
