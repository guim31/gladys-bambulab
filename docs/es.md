# Bambu Lab

Siga y controle sus impresoras 3D Bambu Lab (series X1, P1, A1, H2 y P2S)
desde Gladys: estado, progreso, tiempo restante, capas, temperaturas, bobinas
del AMS, errores HMS, luz del recinto, velocidad, pausa y reanudación, imagen
de la cámara (P1 y A1). Todo se queda en su red local: Gladys se comunica
directamente con la impresora (MQTT cifrado en el puerto 8883, como Bambu
Studio en modo LAN), sin pasar por la nube de Bambu Lab.

**Desarrollada sin el hardware**: la integración se ha probado con informes
reales de impresoras (publicados por el proyecto ha-bambulab) reproducidos
por un broker MQTT cifrado real, pero todavía no con una impresora física. Sus
comentarios son bienvenidos en el foro de Gladys.

## Requisitos

- Gladys Assistant 5.1 o posterior.
- Una impresora Bambu Lab en la misma red local que Gladys.
- Su **número de serie** (ajustes de la impresora, información del
  dispositivo, o Bambu Handy / Bambu Studio) y su **código de acceso LAN**
  (se muestra en la pantalla de la impresora, en los ajustes de red / WLAN).
- Para **pausar, reanudar, cancelar o cambiar la velocidad** desde Gladys con
  un firmware reciente (X1 01.08.05, P1 01.08.02, A1 01.05 y posteriores, el
  «Authorization Control» de 2025): active en la impresora el **modo Solo
  LAN** y después el **modo Desarrollador**. Sin él, la impresora rechaza
  estos comandos; el estado, la luz y la cámara funcionan igualmente.
  Atención: en modo Solo LAN, Bambu Handy y la impresión remota por la nube
  dejan de funcionar. Consulte la
  [wiki de Bambu Lab](https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode).

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. Introduzca el **Número de serie** (por ejemplo `01P00A000000000`) y el
   **Código de acceso** de la impresora.
3. **Dirección IP**: opcional. Si la deja vacía, Gladys escucha los anuncios
   de la impresora en la red y la encuentra sola (y la sigue si su dirección
   cambia). Introdúzcala si la búsqueda no encuentra la impresora. Guarde.
4. El botón **Buscar impresoras en la red** enumera las impresoras que se
   anuncian: nombre, modelo, dirección, número de serie, modo LAN.
5. Una segunda o tercera impresora: rellene **Impresora 2** e **Impresora 3**
   de la misma forma.
6. **Imágenes de la cámara** (activado por defecto): una imagen por minuto
   durante una impresión, y a petición, para las series P1 y A1.
7. **Comprobar el certificado de la impresora** (activado por defecto): la
   conexión está cifrada y el certificado de la impresora se comprueba frente
   a las autoridades de Bambu Lab. Desactívelo solo si la conexión falla con
   un error de certificado (un modelo muy reciente).
8. **Idioma** elige el idioma de los nombres de las funciones y de los textos
   que crea la integración (francés por defecto). Los nombres de las funciones
   se fijan al añadir el dispositivo en Gladys.

El botón **Probar la conexión** indica para cada impresora su modelo, su
firmware, su estado y si el firmware rechaza los comandos. Después, añada la
impresora desde la pestaña **Descubrir**.

## El dispositivo impresora

Un dispositivo por impresora, con el nombre dado a la impresora (encontrado
por la búsqueda en la red) o el de su modelo. La impresora envía su estado
cada segundo; la integración lo transmite a Gladys como mucho cada
5 segundos, y en el acto cuando cambia el estado de la impresión.

| Función                | Lo que muestra                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Estado                 | Lista, Preparando, Imprimiendo, En pausa, Terminada, Fallida, Desconectada, Impresora inaccesible, Código de acceso rechazado |
| Archivo                | El nombre de la impresión en curso, o de la última                                                                            |
| Progreso               | Porcentaje de la impresión                                                                                                    |
| Tiempo restante        | Estimado por la impresora, en minutos                                                                                         |
| Capa, Capas totales    | Números de capa (una escena puede comprobar «capa > 3»)                                                                       |
| Boquilla, Cama         | Temperaturas, en grados enteros, y sus consignas, de solo lectura                                                             |
| Recinto                | Temperatura del recinto (X1, H2, P2S), y su consigna en los modelos con recinto calefactado (X1E, H2)                         |
| Velocidad de impresión | Lista: Silencioso, Estándar, Deportivo, Extremo (durante una impresión)                                                       |
| Luz del recinto        | Interruptor                                                                                                                   |
| Pausar, Reanudar       | Pulsadores                                                                                                                    |
| Errores HMS            | «Ningún error», o el código y el texto del primer error HMS (y el número de los demás)                                        |
| Cámara                 | La imagen de la cámara (series P1 y A1)                                                                                       |

A propósito, el dispositivo no tiene botón **cancelar**: una pulsación sin
confirmación arruinaría una impresión. La cancelación se ofrece en el widget
(con confirmación) y en las escenas. Las consignas de temperatura son de solo
lectura y la integración nunca calienta: nada puede iniciar un calentamiento
desde el panel, HomeKit, Alexa o Google. Para Gladys son «temperaturas de
dispositivo»: nunca cuentan en la temperatura de la habitación. La luz es un
interruptor, no una lámpara: una escena «apagar todas las luces» no deja una
impresión (y su timelapse) a oscuras.

## Widget del panel

Añada el widget **Impresión 3D Bambu** a un panel y elija la impresora en sus
ajustes. Muestra:

- el indicador de progreso, el tiempo restante, las temperaturas de la
  boquilla y de la cama (en directo);
- la última imagen de la cámara (P1, A1);
- el estado, el archivo, la capa, la hora prevista de fin, la velocidad, los
  errores HMS;
- las bobinas cargadas en el AMS (`AMS A1`, `AMS A2`… `AMS B1` para un
  segundo AMS): material, color y resto estimado, la que está en uso marcada
  con una marca; si no, la bobina externa;
- los botones útiles en cada momento: **Pausar** o **Reanudar** y
  **Cancelar** (pide confirmación) durante una impresión, **Encender** o
  **Apagar** la luz en otro caso. Si el firmware rechaza los comandos, el
  widget lo indica («Modo Desarrollador necesario») en lugar de mostrar
  botones inútiles.

## Desencadenantes de escena

En la categoría **Integraciones** del editor de escenas. Cada uno puede
limitarse a una impresora.

- **Impresión iniciada**: variables nombre de la impresora, archivo.
- **Impresión terminada**: variables nombre de la impresora, archivo, tiempo
  de impresión (en texto, como `1 h 05 min`, y en minutos).
- **Impresión fallida o cancelada**: puede limitarse a un motivo (cancelada,
  error). Variables nombre de la impresora, archivo, tiempo, motivo, código y
  mensaje de error.
- **Impresión en pausa**: por un usuario o por la propia impresora (fin del
  filamento, atasco). Variables nombre de la impresora, archivo, tiempo
  transcurrido, código y mensaje de error si lo hay.
- **Error HMS**: una nueva alerta de la supervisión de la impresora. Puede
  limitarse a una gravedad (fatal, grave, común, información). Variables
  nombre de la impresora, código (`0300_0100_0001_0007`), mensaje (en el
  idioma de la integración), gravedad.

Las variables se leen en las acciones siguientes con, por ejemplo,
`{{triggerEvent.data.file}}` y `{{triggerEvent.data.message}}`. Los
desencadenantes siguen a la propia impresora: una impresión lanzada desde
Bambu Studio o pausada en la pantalla también los activa.

## Acciones de escena

- **Pausar, reanudar o cancelar una impresión**: devuelve **Aplicado** falso
  cuando no había nada que pausar, reanudar o cancelar (la escena continúa).
  Una cancelación es definitiva.
- **Encender o apagar la luz del recinto**: funciona también sin el modo
  Desarrollador.
- **Cambiar la velocidad de impresión**: Silencioso, Estándar, Deportivo,
  Extremo; solo durante una impresión (si no, Aplicado: falso).

## Ejemplos de escenas

- **Impresión terminada → notificación**: desencadenante Impresión terminada,
  acción «Enviar un mensaje»:
  `{{triggerEvent.data.file}} terminado en {{triggerEvent.data.duration}}`.
- **Humo detectado → detenerlo todo**: desencadenante en el detector de humo,
  acciones Pausar, reanudar o cancelar una impresión (cancelar), y después
  apagar el enchufe inteligente de la impresora.
- **Silencio por la noche**: a las 22 h, Cambiar la velocidad de impresión
  (Silencioso); sin efecto si no se imprime nada.
- **Error grave → alerta**: desencadenante Error HMS limitado a las gravedades
  fatal y grave, acción «Enviar un mensaje»:
  `{{triggerEvent.data.printer}}: {{triggerEvent.data.message}}`.

## Solución de problemas

- **Impresora inaccesible**: compruebe la dirección IP (pantalla de la
  impresora, ajustes de red), que la impresora está encendida y en la misma
  red que Gladys. Deje la dirección vacía para que Gladys la busque.
- **Código de acceso o número de serie rechazado**: el código de acceso puede
  cambiar (modo LAN desactivado y vuelto a activar, restablecimiento);
  vuelva a introducirlo. Compruebe también el número de serie
  (15 caracteres). Tras un rechazo, la integración espera 5 minutos antes de
  volver a intentarlo.
- **Certificado inesperado**: un modelo más reciente que las autoridades que
  conoce la integración; desactive **Comprobar el certificado de la
  impresora** e infórmelo en el foro.
- **«El firmware de la impresora solo acepta comandos de las aplicaciones de
  Bambu Lab»**: active el modo Solo LAN y después el modo Desarrollador en la
  impresora (consulte Requisitos).
- **La búsqueda en la red no encuentra nada**: escucha los anuncios de las
  impresoras durante 10 segundos (puertos UDP 1990 y 2021, a través de
  Gladys); una red que bloquea la difusión (VLAN, Wi-Fi de invitados) los
  oculta. Introduzca entonces la dirección IP.
- **Sin imagen de cámara**: solo las series P1 y A1 tienen una cámara
  accesible así; Gladys rechaza una imagen de más de 150 KB.
- Registros: en la página de la integración en Gladys, o `docker logs` en el
  host. `LOG_LEVEL=debug` da el detalle. El código de acceso nunca aparece en
  los registros.

## Límites

- Tres impresoras como máximo.
- No se envían archivos ni se inician impresiones, sin comandos G-code, sin
  ajuste de temperatura, sin timelapse.
- Cámara: solo series P1 y A1 (las series X1, H2 y P2S graban en RTSPS, que
  la integración no lee), una imagen por minuto durante una impresión y a
  petición, sin flujo de vídeo.
- H2D: la temperatura mostrada es la de la boquilla activa.
- Los textos de los errores HMS proceden de las tablas que publica Bambu Lab
  (recopiladas por ha-bambulab): un código muy reciente puede aparecer sin
  texto.
- Una impresión terminada mientras la integración estaba desconectada no
  activa ninguna escena.
- Desarrollada sin el hardware: sus comentarios son bienvenidos.
- Sin relación con Bambu Lab.
