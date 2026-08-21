<div align="center">

# ⚡ PocketPal Root Agent

### Android AI-agent with Root · Termux / ZeroTermux · Linux · Memory · Scheduled Tasks

**Персональный форк PocketPal, превращающий обычный AI-чат в инструмент управления Android с проверяемыми tool-вызовами, долгой памятью и автономными задачами.**

[![Android](https://img.shields.io/badge/Android-Root%20Agent-111111?logo=android&logoColor=3DDC84)](https://github.com/mishaqp/PocketPal-Root-Agent)
[![PocketPal](https://img.shields.io/badge/Upstream-PocketPal-111111)](https://github.com/a-ghorbani/pocketpal-ai)
[![Latest build](https://img.shields.io/badge/Dev%20Build-%2397%20SUCCESS-1f883d)](https://github.com/mishaqp/PocketPal-Root-Agent/actions/runs/32490713945)
[![PR](https://img.shields.io/badge/PR-%232-blue)](https://github.com/mishaqp/PocketPal-Root-Agent/pull/2)

</div>

---

## 🚀 Что это

**PocketPal Root Agent** расширяет PocketPal поверх его AgentRunner и добавляет Android-инструменты, Termux/ZeroTermux, PRoot Linux, долговременную память, возобновляемые задачи и автономный планировщик.

Ключевой принцип проекта — **tool-first**: если модели нужно узнать текущее состояние телефона или выполнить поддерживаемое действие, она должна вызвать реальный инструмент, а не придумывать результат.

> Проект экспериментальный и рассчитан на личное использование на Android-устройстве с root-доступом.

---

## 🟢 Текущий статус

| Компонент | Состояние |
|---|---|
| Стабильная база | `main` |
| Активная ветка разработки | `agent/android-control-phase2` |
| Pull Request | [#2 — Expand fixed Android control surface](https://github.com/mishaqp/PocketPal-Root-Agent/pull/2) |
| Последняя успешная dev-сборка | **Run #97 — SUCCESS** |
| Commit Run #97 | `f133831276d47cc7885177406a31d78ea02e32ee` |
| APK | [Открыть Run #97 → Artifacts → PocketPal-Root-Agent-apk](https://github.com/mishaqp/PocketPal-Root-Agent/actions/runs/32490713945) |
| Upstream PocketPal | pinned commit `5e0f72b599886f77ab5b0c5c4074347b6f4a1262` |

---

## 🧠 Основные возможности

| Возможность | Что делает |
|---|---|
| **Android Root Control** | Диагностика и фиксированные root-действия через `android_system` |
| **Termux / ZeroTermux** | Структурированный запуск команд через `RunCommandService` |
| **PRoot Linux** | Обнаружение и запуск команд внутри PRoot-Distro |
| **Long-term Memory** | Глобальная память и отдельная память Pal |
| **Task Checkpoints** | Сохраняет прогресс длинных задач и умеет продолжать после прерывания |
| **Scheduled Agent** | Автономные задачи по времени через AlarmManager + Headless JS |
| **Scheduled Tasks Center** | Экран управления задачами, ручной запуск, отключение, удаление и история |
| **Runtime Health** | Единое состояние Root / Termux / Linux / Agent и self-test |
| **Agent Extensions** | `SKILL.md` и permission-limited JSON plugins |
| **DeepSeek preset** | Готовая конфигурация удалённой/API-модели |

---

## ⏰ Scheduled Tasks Center

В актуальной dev-сборке агент умеет создавать задачи, которые могут проснуться позже и выполнить сохранённый prompt без открытого чата.

Поддерживается:

- запуск **через N минут**;
- запуск по **фиксированной дате и времени**;
- **ежедневный повтор** в то же локальное время;
- режимы `read_only` и `action`;
- отдельное разрешение на reboot;
- уведомление о результате;
- **Run now**;
- отключение и удаление задачи;
- история последних запусков;
- восстановление расписаний после перезагрузки устройства и обновления приложения.

Планировщик использует Android `AlarmManager`, foreground Headless-JS service и обычный AgentRunner. Для выполнения сохраняется конкретная remote/API-модель, выбранная при создании задачи.

---

## 📱 Android Root Control

`android_system` не открывает модели произвольный root-shell. Вместо этого он предоставляет фиксированный и проверяемый набор операций.

Поддерживаемые действия:

- `access_status` — проверка root-канала и реального `uid=0`;
- `system_info` — модель устройства, Android/build/boot state;
- `battery_status` — заряд, питание, температура;
- `storage_info` — место в `/data`;
- `get_brightness` / `set_brightness`;
- `list_packages` / `package_info`;
- `launch_app` / `force_stop_app`;
- `tap` / `swipe`;
- allowlisted `key_event`;
- reboot в normal / recovery / bootloader с отдельной защитой.

Пакеты, координаты, системные свойства, key events и reboot-target проверяются перед выполнением.

---

## 🐧 Termux / ZeroTermux + Linux

Agent использует стандартный `com.termux.app.RunCommandService` и поддерживает Termux-совместимые сборки с package `com.termux`, включая ZeroTermux.

### Доступные действия

- `status` — состояние Termux и разрешений;
- `probe` — реальный `id` с stdout/stderr/exit code;
- `exec` — executable + argv без скрытой склейки shell-команды;
- `linux_detect` — поиск PRoot-Distro;
- `linux_exec` — запуск команды внутри выбранного Linux-контейнера.

### Одноразовая настройка

1. Выдать Root Agent разрешение **Run commands in Termux environment**.
2. В Termux/ZeroTermux добавить:

```properties
allow-external-apps=true
```

в `~/.termux/termux.properties`.

3. Перезапустить терминал и выполнить `termux → probe`.

---

## 💾 Память и продолжение задач

Проект добавляет две разные вещи:

### Long-term Memory

- глобальная память;
- память конкретного Pal;
- отдельный `memory` talent.

### Task Checkpoints

`task_checkpoint` сохраняет:

- текущую задачу;
- последний подтверждённый шаг;
- следующий шаг;
- workspace;
- заметки;
- последний результат инструмента;
- причину прерывания.

После сетевой/API-ошибки агент получает сохранённый checkpoint и сначала проверяет реальное состояние телефона/файлов/процессов, а уже потом продолжает работу.

---

## 🧩 Agent Extensions

Поддерживаются локальные расширения:

- prompt-only `SKILL.md`;
- declarative JSON plugins;
- включение/выключение расширений;
- отдельный `agent_extensions` talent.

Пример manifest:

```json
{
  "id": "research-kit",
  "name": "Research Kit",
  "description": "Search and read web pages",
  "talents": ["web_search", "read_url"]
}
```

Импортируемые плагины **не получают** `android_system`, `termux`, `task_checkpoint` или `scheduled_agent` и не могут незаметно унаследовать привилегии Root Agent.

---

## 🛡️ Границы безопасности

Проект специально разделяет возможности:

- нет произвольного Android root-shell endpoint;
- root-действия доступны только через типизированные операции;
- Termux получает executable + argv, а не скрытый network shell;
- импортируемые плагины не получают root/Termux/scheduler;
- scheduled-задачи по умолчанию создаются в `read_only`;
- reboot для unattended-задачи требует отдельного разрешения;
- tool-result считается истинным только после реального выполнения инструмента.

---

## 📦 Установка свежей dev-сборки

1. Открой [GitHub Actions Run #97](https://github.com/mishaqp/PocketPal-Root-Agent/actions/runs/32490713945).
2. Пролистай до **Artifacts**.
3. Скачай **PocketPal-Root-Agent-apk**.
4. Распакуй ZIP.
5. Установи APK на Android.

Package id форка:

```text
com.mikhail.pocketpalrootagent
```

Он отдельный от оригинального PocketPal, поэтому обе версии могут быть установлены одновременно.

---

## 🔧 Как собирается проект

GitHub Actions workflow:

```text
.github/workflows/build-root-agent.yml
```

Сборка:

1. checkout этого репозитория;
2. checkout pinned PocketPal upstream;
3. применение overlay;
4. применение provider / Agent / DSML / Root / Termux / scheduler интеграций;
5. установка зависимостей;
6. `assembleProdRelease`;
7. проверка APK payload;
8. загрузка APK в GitHub Actions Artifacts.

Такой подход сохраняет форк воспроизводимым и не требует хранить полную копию upstream-кода.

---

## 🗂️ Архитектура

```text
overlay/
├── android/                    # Native Android bridge/modules
└── src/
    ├── services/
    │   ├── androidControl/
    │   ├── scheduledAgent/
    │   ├── taskCheckpoint/
    │   ├── rootAgent/
    │   └── termux/
    └── screens/                # Root Agent / Diagnostics / Scheduled Tasks UI

patches/                        # Upstream integration patches
scripts/                        # Deterministic build-time integrations
.github/workflows/              # APK CI
ROOT_AGENT.md                   # Extended technical notes
```

---

## 🧪 Проверенная dev-сборка

**Run #97** завершился со статусом `success` и создал APK artifact.

- Run: `#97`
- Commit: `f133831276d47cc7885177406a31d78ea02e32ee`
- Artifact: `PocketPal-Root-Agent-apk`
- Workflow: `Build PocketPal Root Agent APK`

👉 **[Скачать через GitHub Actions](https://github.com/mishaqp/PocketPal-Root-Agent/actions/runs/32490713945)**

---

## 🙌 Основа проекта

PocketPal Root Agent построен поверх открытого проекта [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai).

Спасибо авторам PocketPal за исходную архитектуру приложения и AgentRunner.

---

<div align="center">

### ⚡ PocketPal Root Agent
**Android · Root · AI · Termux · Linux · Memory · Automation**

</div>
