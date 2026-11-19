# claude-settings

Bộ cấu hình Claude Code mình đang dùng: luật chung (`CLAUDE.md`), agent (savvy-*, architect, builder, scout), skill (prompt-kit, ponytail, savvy-flow, ui-design, video, research...) và vài plugin/mod.

## Có gì
| Thư mục / file | Đặt vào | Ghi chú |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | Luật làm việc, cách chia việc cho agent, HANDOFF.md. Đang để trả lời bằng tiếng Việt, Windows + PowerShell: sửa nếu khác. |
| `agents/` | `~/.claude/agents/` | Agent `savvy-light/medium/careful/heavy` (Haiku/Sonnet/Opus) + `architect`, `builder`, `scout`. |
| `skills/` | `~/.claude/skills/` | Skill dùng chung. |
| `settings.json` | `~/.claude/settings.json` | Model, plugin bật sẵn, marketplace. |
| `plugins/` | tự cài qua marketplace | `secrets-guard`, `test-on-edit`, `dev-servers`. |

Plugin ngoài được kéo từ GitHub: [ponytail](https://github.com/DietrichGebert/ponytail) (chế độ code tối giản) và `savvy-progress` từ [claude-kit](https://github.com/johnnyvizz/claude-kit) (thanh tiến độ + bảng agent).

## Cài (PowerShell)
Sao lưu `~/.claude` trước nếu bạn đã có cấu hình riêng: lệnh dưới sẽ ghi đè file trùng tên.

```powershell
git clone https://github.com/golducker/claude-settings.git "$HOME\claude-settings"
```

```powershell
$c = "$HOME\.claude"; New-Item -ItemType Directory -Force $c | Out-Null; Copy-Item "$HOME\claude-settings\CLAUDE.md","$HOME\claude-settings\settings.json" $c -Force; Copy-Item "$HOME\claude-settings\agents","$HOME\claude-settings\skills" $c -Recurse -Force
```

Mở lại Claude Code; lần đầu nó sẽ hỏi cài các plugin trong `settings.json`, bấm đồng ý.

## Tuỳ chỉnh
- `plugins/dev-servers/hooks/register.tsx`: thêm thư mục dự án của bạn vào `SEEDS`.
- Không cần skill nào thì xoá thư mục của nó trong `~/.claude/skills/`.
