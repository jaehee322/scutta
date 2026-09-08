from __future__ import annotations

DEFAULT_PADDLE_EQUIPMENT = {
    "background": "bg_classic",
    "paddle": "paddle_classic",
    "ball": "ball_classic",
}

# The three starter skins are granted implicitly and never enter the chest pool.
PADDLE_CHEST_SKINS = (
    ("bg_dawn", "background", 12),
    ("bg_mint", "background", 12),
    ("bg_coast", "background", 12),
    ("bg_aurora", "background", 4),
    ("bg_midnight", "background", 4),
    ("bg_cosmos", "background", 1),
    ("bg_sakura", "background", 12),
    ("bg_glacier", "background", 4),
    ("paddle_cobalt", "paddle", 12),
    ("paddle_jade", "paddle", 12),
    ("paddle_coral", "paddle", 12),
    ("paddle_carbon", "paddle", 4),
    ("paddle_amethyst", "paddle", 4),
    ("paddle_imperial", "paddle", 1),
    ("paddle_maple", "paddle", 12),
    ("paddle_titanium", "paddle", 4),
    ("ball_tangerine", "ball", 12),
    ("ball_mint", "ball", 12),
    ("ball_sky", "ball", 12),
    ("ball_pearl", "ball", 4),
    ("ball_obsidian", "ball", 4),
    ("ball_solar", "ball", 1),
    ("ball_berry", "ball", 12),
    ("ball_lagoon", "ball", 4),
)
PADDLE_SKIN_CATEGORIES = {
    **{skin_id: category for category, skin_id in DEFAULT_PADDLE_EQUIPMENT.items()},
    **{skin_id: category for skin_id, category, _weight in PADDLE_CHEST_SKINS},
}
