# dotrino-social-bot

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

El bot que publica las noticias de Dotrino. **Publica primero en [eco](https://eco.dotrino.com)**, con
el perfil de Dotrino, y después comparte en X, LinkedIn y Discord **el enlace de ese eco**: las redes
apuntan a eco, no al revés. Las noticias se buscan **a diario**: las elige y redacta una IA a partir de
lo que publicaron los medios en los últimos dos días, y el bot no publica nada de más de tres días.

## Cómo es un aparato de Dotrino

El bot es un aparato más del acta del perfil de Dotrino, enrolado por el camino estándar de los
agentes headless (`@dotrino/remote-agent/link`). Lo que puede hacer lo dice la invitación con la
que se emparejó — **`dotrino-vault pair --service eco --scope sign`** —, no un tipo de aparato:

- **`vault:sign`**: firma sus ecos con su propia llave (como cualquier aparato de la app;
  `authorName: Dotrino`) y abre sesión con el node de contenido por el plano de control;
- **`vault:secrets:eco`**: lee **su** cajón de secretos (`BUFFER_API_KEY`, `DISCORD_BOT_TOKEN`,
  `DISCORD_GUILD_ID`, `DEEPSEEK_API_KEY`) del vault — no hay `.env`;
- nada más: ni leer ni escribir los datos del perfil, ni otros cajones.

Quitarlo es revocar ese aparato en el vault.

## De dónde salen las noticias

`dotrino-social-bot refresh` — deja listas **3 noticias frescas sin publicar** (una por red al día). Si
ya las hay, no hace nada: ni red ni bóveda. Por eso corre antes de cada post.

1. **los medios** de `content/feeds.json` (RSS/Atom): se toma lo publicado en las **últimas 48 h**, con
   la fecha que pone el medio, y se descarta lo que ya se eligió o publicó antes;
2. **la IA elige** (DeepSeek, `src/llm.js`): privacidad de los datos, seguridad que afecta a la gente,
   IA y datos personales, soberanía de la información; una sola noticia por tema;
3. **se lee el artículo**: su propia fecha manda sobre la del feed (hay feeds que re-listan lo viejo) y
   su texto es lo único con lo que se redacta. Si el medio no deja leerlo, se usa el resumen del feed,
   y con menos de 300 caracteres de texto la noticia no entra;
4. **la IA redacta** las tres versiones (X, LinkedIn, Discord) con las reglas de `WRITE_PROMPT`
   (`src/news.js`), y **el código las comprueba** (`checkPost`, `src/text.js`): longitud por red, sin
   emojis, sin enlaces, sin mencionar a Dotrino, sin voseo. Lo que falla vuelve al modelo una vez; si
   falla otra vez, la noticia no entra;
5. se guardan en `~/.local/share/dotrino/social-bot/news.json` (`SOCIAL_POOL` lo cambia).

`dotrino-social-bot news` lista las noticias redactadas, si siguen frescas y en qué redes salieron.

## Qué hace en cada corrida

`dotrino-social-bot post <twitter|linkedin|discord>` — una corrida, un post:

1. toma la noticia que le toca: publicada hace **3 días o menos** y sin publicar en esa red; entre esas,
   la que no salió en ninguna otra y, a igualdad, la más reciente. **Si no hay ninguna, no publica** y
   termina con error: publicar una noticia vieja es el fallo que el refresco existe para quitar;
2. **la imagen**: pide el artículo de `source`, toma la `og:image` que él mismo declara y la
   re-codifica a JPEG ≤ 200 KB (una `og:image` de un medio pasa medio mega; el plano de control
   lleva 256 KB). Se sube al node como blob **público y pineado**, y esa misma imagen va en los tres
   sitios: dentro del eco firmado (`media`), como miniatura de la copia pública —que es lo que pinta
   la tarjeta— y adjunta al post de la red. Sin `og:image` el post sale igual, con el `og.jpg` del
   ecosistema: una imagen no vale un post;
3. **eco**: arma el eco (texto recortado a 280 por frase, la fuente en `links`, los `#tags`), lo firma,
   pone el beacon en geo (24 h, Quito) y deja la **copia pública pineada** en el node de Dotrino por
   el plano de control (`ContentClient`, como la app). El beacon es efímero; el enlace
   `https://eco.dotrino.com/#<owner>/<cid>` dura lo que el node lo sirva;
4. **la red**: en X el texto + el enlace del eco; en LinkedIn y Discord además `Fuente:`. El enlace es el
   **permalink** `https://dotrino.com/p/<cid>` (la tarjeta OG que sirve el node de Dotrino en modo público,
   con el texto entero, los enlaces del eco y un enlace «Abrir en eco.dotrino.com»): un `#fragment` no da
   tarjeta en las redes. `SOCIAL_PERMALINK_BASE` lo cambia;
5. anota la fuente en el estado (`~/.local/share/dotrino/social-bot/state.json`) solo si las dos cosas
   pasaron: es lo que impide publicar dos veces la misma noticia en una red.

Si eco falla no se publica nada en la red. `--dry` muestra sin publicar.

## Instalar (en cualquier máquina)

```bash
git clone git@dotrino:imdotrino/dotrino-social-bot.git && cd dotrino-social-bot && npm install
# en el vault:      dotrino-vault pair --service eco --scope sign   → invitación
node bin/cli.js enroll '<invitación>'                   # imprime el código → dotrino-vault approve <código>
# en el vault:      dotrino-vault secret set eco BUFFER_API_KEY=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… DEEPSEEK_API_KEY=…
node bin/cli.js whoami && node bin/cli.js channels
DEEPSEEK_API_KEY=… node bin/cli.js refresh --dry        # en seco no toca la bóveda ni guarda nada
node bin/cli.js refresh && node bin/cli.js post twitter --dry
```

La identidad vive en `~/.local/share/dotrino-social-bot/link.json` (`SOCIAL_BOT_DIR` la cambia).

Cron (hora de Ecuador, UTC−5), `bin/cron.sh <red>` — refresca y publica, con log en `social-poster.log`:

```cron
0 18 * * * $HOME/dotrino-social-bot/bin/cron.sh twitter
0 21 * * * $HOME/dotrino-social-bot/bin/cron.sh linkedin
0 0 * * * $HOME/dotrino-social-bot/bin/cron.sh discord
```

## Contenido

No hay contenido escrito a mano. Lo que se edita:

- **`content/feeds.json`**: los medios. Solo feeds con fecha de publicación; `name` es como se cita al
  medio en el post.
- **`SELECT_PROMPT` y `WRITE_PROMPT`** (`src/news.js`): qué se elige y cómo se cuenta. Español neutro
  (tuteo, sin voseo), sin emojis, solo hechos que estén en el texto del medio y atribuidos a él, tono
  sobrio, sin mencionar a Dotrino ni llamadas a la acción.
- **`POST_LIMITS` y `checkPost`** (`src/text.js`): lo que se comprueba en código antes de guardar.

## Licencia

MIT
