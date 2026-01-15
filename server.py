from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Literal
from pathlib import Path
from copy import deepcopy
import json
import re
import os

from openai import OpenAI

# ================== FastAPI setup ==================

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================== Card DB ==================

BASE_DIR = Path(__file__).resolve().parent
CARD_DB_PATH = BASE_DIR / "godfield_cards.json"

CARD_DB: Dict[str, Dict[str, Any]] = {}
if CARD_DB_PATH.exists():
    try:
        raw = json.loads(CARD_DB_PATH.read_text(encoding="utf-8"))
        for entry in raw:
            if isinstance(entry, dict) and "name" in entry:
                CARD_DB[entry["name"]] = entry
    except Exception as e:
        print("[GF AI] failed to load card DB:", e)
else:
    print("[GF AI] godfield_cards.json not found; CARD_DB will be empty")

# ================== Models ==================


class Status(BaseModel):
    name: str
    raw_text: str


class Card(BaseModel):
    index: int
    name: str
    overlay: str = ""
    raw_text: str
    usable: Optional[bool] = None


class IncomingCard(BaseModel):
    index: int
    name: str
    overlay: str = ""
    raw_text: str


class BuyCandidate(BaseModel):
    index: int
    name: str
    overlay: str = ""
    raw_text: str


class Player(BaseModel):
    name: str
    hp: int
    mp: int
    gold: int
    statuses: List[Status] = []


class GFInfo(BaseModel):
    current: int
    max: int


class SeenMiracles(BaseModel):
    me: List[str] = Field(default_factory=list)
    enemy: List[str] = Field(default_factory=list)


class GFState(BaseModel):
    phase: str
    gf: Optional[GFInfo] = None
    me: Player
    enemy: Player
    hand: List[Card] = []
    incomingCards: List[IncomingCard] = []
    buyCandidate: Optional[BuyCandidate] = None
    seenMiracles: Optional[SeenMiracles] = None


class ExchangePlan(BaseModel):
    hp: int
    mp: int
    gold: int


class Action(BaseModel):
    type: str
    cardIndices: List[int] = []
    reason: str
    buy: Optional[int] = None
    exchange: Optional[ExchangePlan] = None
    target: Optional[Literal["enemy", "self"]] = None  # ★追加

# ================== Logging Helpers ==================


LOG_FILE_PATH = BASE_DIR / "ai_thinking.log"


def write_debug_log(text: str):
    try:
        with open(LOG_FILE_PATH, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    except Exception as e:
        print(f"[LOG ERROR] {e}")


def get_card_name(indices: list[int], hand: list[Card]) -> list[str]:
    names = []
    for i in indices:
        c = next((x for x in hand if x.index == i), None)
        names.append(f"{c.name}({c.overlay})" if c else f"Unknown({i})")
    return names


def format_state_for_log(state: GFState, history: list) -> str:
    lines = []
    me_st = ",".join([s.name for s in state.me.statuses]) or "None"
    en_st = ",".join([s.name for s in state.enemy.statuses]) or "None"
    lines.append(
        f"ME   : HP{state.me.hp} MP{state.me.mp} ¥{state.me.gold} | Status: [{me_st}]")
    lines.append(
        f"ENEMY: HP{state.enemy.hp} MP{state.enemy.mp} ¥{state.enemy.gold} | Status: [{en_st}]")
    # ★ ここを追加
    if state.seenMiracles is None:
        lines.append("SEEN MIRACLES: (missing in state)")
    else:
        me = state.seenMiracles.me or []
        en = state.seenMiracles.enemy or []

        def tail(xs, n=6):
            return ", ".join(xs[-n:]) if xs else "None"

        lines.append(
            f"SEEN MIRACLES: me({len(me)}): {tail(me)} | enemy({len(en)}): {tail(en)}"
        )

    if state.incomingCards:
        lines.append("INCOMING:")
        for c in state.incomingCards:
            lines.append(f"   [{c.index}] {c.name} ({c.overlay})")

    lines.append("HAND:")
    for c in (state.hand or []):
        mark = " " if c.usable is not False else "x"
        info = lookup_card_db(c.name) or {}
        cost = info.get("mp_cost", 0)
        lines.append(
            f" {mark} [{c.index:2}] {c.name:<12} ({c.overlay}) Cost:{cost}")

    lines.append("HISTORY (Last 3):")
    for h in history[-3:]:
        act = h.get('action')
        cards = h.get('card_indices', [])
        lines.append(
            f"   T{h.get('turn')}: {act} {cards} -> Dmg(Me:{h.get('damage_to_me')} En:{h.get('damage_to_enemy')})")

    return "\n".join(lines)

# ================== Regex & Logic Helpers ==================


_main_atk_re = re.compile(r"^攻(\d+)")
_prob_atk_re = re.compile(r"(\d+)%攻(\d+)")
_plus_atk_re = re.compile(r"^\+攻|攻\+")
_shield_re = re.compile(r"守(\d+)")
_price_re = re.compile(r"¥\s*(\d+)")


def normalize_card_name(name: str) -> str:
    name = re.sub(r"[＜＞<>]", "", name)
    return name.strip()


def lookup_card_db(name: str) -> dict | None:
    info = CARD_DB.get(name)
    if info:
        return info
    base = normalize_card_name(name)
    return CARD_DB.get(base)


def classify_attack_card(overlay: str, info: dict) -> str:
    """
    攻撃カードの種類判定 (DB優先版)
    ★DBが武器/奇跡でなければ強制的にother（攻撃不可）扱いにする
    """
    category = info.get("category", "")
    description = info.get("description") or ""

    # 武器でも奇跡でもないなら攻撃計算には入れない
    if category not in ["weapon", "miracle"]:
        return "other"

    if "追加" in description:
        return "plus"

    hit_rate = info.get("hit_rate", 1.0)
    if hit_rate < 1.0:
        return "prob"

    if not overlay:
        return "main"
    if _prob_atk_re.search(overlay):
        return "prob"
    if _plus_atk_re.search(overlay):
        return "plus"
    if _main_atk_re.search(overlay):
        return "main"

    return "main"


def approx_card_attack(card: Card) -> int:
    text = f"{card.overlay or ''} {card.raw_text or ''}"
    m_prob = _prob_atk_re.search(text)
    if m_prob:
        try:
            return max(1, round(int(m_prob.group(2)) * int(m_prob.group(1)) / 100))
        except:
            pass
    m_main = _main_atk_re.search(text)
    if m_main:
        return int(m_main.group(1))
    m_plus = re.search(r"(\d+)", text)
    if m_plus:
        return int(m_plus.group(1))
    return 0


def approx_card_shield(card: Card) -> int:
    text = f"{card.overlay or ''} {card.raw_text or ''}"
    m = _shield_re.search(text)
    return int(m.group(1)) if m else 0


def approx_incoming_attack(card: IncomingCard) -> int:
    text = f"{card.overlay or ''} {card.raw_text or ''}"
    m = _prob_atk_re.search(text)
    if m:
        try:
            return max(1, round(int(m.group(2)) * int(m.group(1)) / 100))
        except:
            pass
    m2 = _main_atk_re.search(text)
    return int(m2.group(1)) if m2 else 0


def approx_card_price(card: Card) -> Optional[int]:
    info = lookup_card_db(card.name) or {}
    price = info.get("price")
    if isinstance(price, (int, float)):
        return int(price)
    for text in (card.raw_text or "", card.overlay or ""):
        v = _price_re.search(text)
        if v:
            return int(v.group(1))
    return None


def is_single_forbidden(card: Card, info: dict) -> bool:
    text = f"{info.get('description', '')} {card.raw_text} {card.name}"
    keywords = ["単体不可"]
    return any(k in text for k in keywords)


def is_recovery_item(card: Card, info: dict) -> bool:
    if info.get("category") == "heal":
        return True
    text = f"{info.get('description', '')} {card.raw_text} {card.name}"
    return "回復" in text or "HP+" in text or "MP+" in text


def normalize_exchange_plan(plan: "ExchangePlan", me: "Player") -> "ExchangePlan":
    total_in = me.hp + me.mp + me.gold
    hp = max(0, int(plan.hp))
    mp = max(0, int(plan.mp))
    gold = max(0, int(plan.gold))

    total_out = hp + mp + gold
    if total_out <= 0:
        return ExchangePlan(hp=me.hp, mp=me.mp, gold=me.gold)

    if total_out != total_in:
        ratio = total_in / total_out
        hp = int(round(hp * ratio))
        mp = int(round(mp * ratio))
        gold = total_in - hp - mp

    min_hp = max(1, int(me.hp * 0.4))
    if hp < min_hp:
        diff = min_hp - hp
        hp = min_hp
        surplus = mp + gold
        if surplus <= 0:
            mp, gold = 0, 0
        else:
            mp_ratio = mp / surplus
            mp = max(0, mp - int(round(diff * mp_ratio)))
            gold = total_in - hp - mp

    return ExchangePlan(hp=hp, mp=mp, gold=gold)


def mask_enemy_if_me_is_kiri(state: dict) -> dict:
    s = deepcopy(state)
    statuses = [st.get("name") for st in s.get("me", {}).get("statuses", [])]
    if "霧" in statuses and "enemy" in s:
        s["enemy"]["hp"] = None
        s["enemy"]["mp"] = None
        s["enemy"]["gold"] = None
        s["enemy"]["info_hidden"] = True
    return s

# ================== Logic Core (Strict Rules) ==================


def sanitize_strict_rules(action_type: str, indices: list[int], state: GFState) -> tuple[str, list[int], list[str]]:
    hand = state.hand or []
    me = state.me
    logs = []

    selected = []
    for i in indices:
        c = next((x for x in hand if x.index == i), None)
        if c:
            selected.append((i, c, lookup_card_db(c.name) or {}))

    if not selected:
        return action_type, [], logs

    if action_type == "sell" or any(s[1].name == "売る" for s in selected):
        sell_card = next((s for s in selected if s[1].name == "売る"), None)
        if not sell_card:
            logs.append("売るカードなし")
            return "none", [], logs
        if sell_card[1].usable is False:
            logs.append("売るカード使用不可")
            return "none", [], logs
        targets = [s for s in selected if s[1].name != "売る"]
        if not targets:
            logs.append("売る対象なし")
            return "none", [], logs
        if len(selected) > 2:
            logs.append(f"売る枚数過多({len(selected)})->2枚に修正")
        return "sell", [sell_card[0], targets[0][0]], logs

    if any(s[1].name == "買う" for s in selected):
        buy_card = next(s for s in selected if s[1].name == "買う")
        if len(selected) > 1:
            logs.append("買う以外のカードを除去")
        return "buy", [buy_card[0]], logs

    if any(s[1].name == "両替" for s in selected):
        ryougae_card = next(s for s in selected if s[1].name == "両替")
        if len(selected) > 1:
            logs.append("両替以外のカードを除去")
        return "exchange", [ryougae_card[0]], logs

    # ★追加: この選択の中に「虹のカーテン」が含まれているか
    has_rainbow = any(c.name == "虹のカーテン" for _, c, _ in selected)
    valid_step = []
    mp_now = me.mp
    for i, c, info in selected:
        if c.usable is False:
            allow = False

            # 1) 攻撃フェーズの「単体不可」カードはコンボ用として許可
            if action_type == "attack" and is_single_forbidden(c, info):
                allow = True
                logs.append(f"[{c.name}] 単体不可カードだが攻撃コンボ候補として暫定的に許可")

            # 2) 防御フェーズで虹のカーテンが一緒に選ばれているときは、防具カードも許可
            elif action_type == "defense" and has_rainbow:
                # ちゃんと「防御として意味があるカード」だけ通したいので、
                # シールド値があるかどうかでざっくり判定する
                allow = True
                logs.append(
                    f"[{c.name}] 虹のカーテン併用のため usable:false を無視して防具として許可")

            if not allow:
                logs.append(f"[{c.name}] usable:falseにより除外")
                continue

        cost = info.get("mp_cost", 0)
        if cost <= mp_now:
            mp_now -= cost
            valid_step.append((i, c, info))
        else:
            logs.append(f"[{c.name}] MP不足({cost}>{mp_now})により除外")

    if not valid_step:
        return action_type, [], logs

    if action_type == "attack":
        mains, probs, pluses, others = [], [], [], []
        for item in valid_step:
            # ★修正: item[2]=info を渡してDBベースで判定
            cat = classify_attack_card(item[1].overlay, item[2])

            if cat == "main":
                mains.append(item)
            elif cat == "prob":
                probs.append(item)
            elif cat == "plus":
                pluses.append(item)
            else:
                others.append(item)  # otherは攻撃コンボの制約を受けない

        all_mains = mains + probs
        if len(all_mains) > 1:
            all_mains.sort(
                key=lambda x: approx_card_attack(x[1]), reverse=True)
            winner = all_mains[0]
            dropped = [m[1].name for m in all_mains if m != winner]
            logs.append(f"メイン武器重複: {dropped} を除外")
            mains = [winner] if winner in mains else []
            probs = [winner] if winner in probs else []

        final_ids = []
        if probs:
            if pluses:
                logs.append("確率攻撃と+攻の混在: +攻を除外")
                pluses = []
            final_ids.extend([x[0] for x in probs])
        else:
            final_ids.extend([x[0] for x in mains])
            final_ids.extend([x[0] for x in pluses])
        final_ids.extend([x[0] for x in others])

        final_objs = [next(x for x in valid_step if x[0] == fid)
                      for fid in final_ids]
        has_standalone = any(not is_single_forbidden(
            obj[1], obj[2]) for obj in final_objs)
        if not has_standalone and final_ids:
            logs.append("単体不可のみのため攻撃キャンセル")
            return action_type, [], logs
        # ... (前略: C-3. 単体不可チェックの後) ...

        # ★追加: 自殺防止 (あぶないウス所持時のあぶないキネ使用禁止)
        # 自分が「あぶないウス」を持っているか確認
        has_usu = any(c.name == "あぶないウス" for c in hand)

        # 攻撃カードの中に「あぶないキネ」が含まれているか確認
        # final_ids は index のリストなので、そこから名前を引く
        kine_indices = []
        for idx in final_ids:
            c_obj = next((x for x in valid_step if x[0] == idx), None)
            if c_obj and c_obj[1].name == "あぶないキネ":
                kine_indices.append(idx)

        if has_usu and kine_indices:
            # ウスを持っているのにキネを使おうとしている -> 自殺行為なのでキネを除外
            logs.append("【自殺防止】'あぶないウス'所持中に'あぶないキネ'を使うと即死するため、キネを除外しました。")
            for k_idx in kine_indices:
                final_ids.remove(k_idx)

            # キネを除外した結果、何もなくなったら攻撃キャンセル
            if not final_ids:
                return action_type, [], logs

        # ... (後略: return "attack", final_ids, logs) ...
        return "attack", final_ids, logs

    if action_type == "defend":
        return "defend", [x[0] for x in valid_step], logs

    recoveries = [x for x in valid_step if is_recovery_item(x[1], x[2])]
    if recoveries:
        if len(valid_step) > 1:
            logs.append("回復単体使用ルール適用")
        return action_type, [recoveries[0][0]], logs

    return action_type, [x[0] for x in valid_step], logs


def adjust_sell_for_lethal(action_type: str, indices: list[int], state: GFState) -> list[int]:
    if action_type != "attack":
        return indices
    hand = state.hand or []
    enemy = state.enemy

    sell_cards = [c for c in hand if c.name == "売る"]
    if not sell_cards:
        return indices
    if not any(c.index in indices for c in sell_cards):
        return indices

    enemy_total = max(0, enemy.hp) + max(0, enemy.mp) + max(0, enemy.gold)
    lethal_candidates = []
    for c in hand:
        if c.name == "売る":
            continue
        price = approx_card_price(c)
        if price is not None and price >= enemy_total:
            lethal_candidates.append((price, c))

    if not lethal_candidates:
        return indices
    lethal_candidates.sort(key=lambda x: x[0])
    target_card = lethal_candidates[0][1]
    sell_idx = next(
        (c.index for c in sell_cards if c.index in indices), sell_cards[0].index)

    print(
        f"[LETHAL OVERRIDE] Selling {target_card.name}({approx_card_price(target_card)}) to kill enemy({enemy_total})")
    return [sell_idx, target_card.index]


def choose_attack_capable_weapon(state: GFState) -> list[int]:
    cands = []
    mp = state.me.mp
    for c in (state.hand or []):
        if c.usable is False:
            continue
        info = lookup_card_db(c.name) or {}
        if info.get("category") != "weapon":
            continue
        if info.get("mp_cost", 0) > mp:
            continue
        if is_single_forbidden(c, info):
            continue
        atk = approx_card_attack(c)
        cands.append((atk, c.index))
    if not cands:
        return []
    cands.sort(key=lambda x: x[0], reverse=True)
    return [cands[0][1]]


def decide_rule_based(state: GFState) -> Action:
    if state.phase == "attack":
        idxs = choose_attack_capable_weapon(state)
        if idxs:
            return Action(type="attack", cardIndices=idxs, reason="Fallback Attack")
        return Action(type="attack-pass", reason="Fallback Pass")
    if state.phase == "defense":
        if not state.incomingCards:
            return Action(type="defense-pass", reason="Fallback")
        best = (0, None)
        for c in state.hand:
            s = approx_card_shield(c)
            if c.usable and s > best[0]:
                best = (s, c.index)
        if best[1] is not None:
            return Action(type="defend", cardIndices=[best[1]], reason="Fallback Defend")
        return Action(type="defense-pass", reason="Fallback No Shield")
    return Action(type="none", reason="Fallback")

# ================== Execution Core ==================


GAME_HISTORY = []
_LAST_STATE = None
_LAST_ACTION = None
_TURN_COUNTER = 0

# --- prompts ---
PROMPT_DIR = Path(os.getenv("GF_PROMPT_DIR", BASE_DIR / "prompts"))


def read_prompt(p: Path, fallback: str = "") -> str:
    try:
        return p.read_text(encoding="utf-8")
    except:
        return fallback


SYSTEM_CORE = read_prompt(PROMPT_DIR / "system_core.txt",
                          fallback="You are Godfield AI. Output JSON only.")

PHASE_PROMPTS = {
    "attack": read_prompt(PROMPT_DIR / "user_attack.txt", fallback=""),
    "defense": read_prompt(PROMPT_DIR / "user_defense.txt", fallback=""),
    "buy_choice": read_prompt(PROMPT_DIR / "user_buy_choice.txt", fallback=""),
}


def phase_key(phase: str) -> str:
    if phase in ("buy-choice", "buy_choice"):
        return "buy_choice"
    return phase


client = OpenAI()


def update_history(new_state: GFState):
    global _LAST_STATE, _LAST_ACTION, _TURN_COUNTER, GAME_HISTORY
    if _LAST_STATE is None:
        _LAST_STATE = new_state
        return
    _TURN_COUNTER += 1
    act_type = _LAST_ACTION.type if _LAST_ACTION else "none"
    act_cards = _LAST_ACTION.cardIndices if _LAST_ACTION else []
    dmg_me = max(0, _LAST_STATE.me.hp - new_state.me.hp)
    dmg_en = max(0, _LAST_STATE.enemy.hp - new_state.enemy.hp)

    GAME_HISTORY.append({
        "turn": _TURN_COUNTER,
        "phase": _LAST_STATE.phase,
        "action": act_type,
        "damage_to_me": dmg_me,
        "damage_to_enemy": dmg_en,
        "card_indices": act_cards
    })
    _LAST_STATE = new_state


def get_history_rounds(max_rounds: int = 6):
    return GAME_HISTORY[-max_rounds:]


def build_llm_state(state: GFState) -> dict:
    s = state.dict()
    s["history_rounds"] = get_history_rounds()

    # hand: DB付与 & overlay誤読除去
    for c in s.get("hand", []):
        info = lookup_card_db(c["name"]) or None
        c["db"] = info

        # 武器/奇跡以外なら攻撃系overlayを消して誤読防止
        if info:
            cat = info.get("category", "")
            if cat not in ["weapon", "miracle"]:
                ov = c.get("overlay", "") or ""
                if "攻" in ov or "%" in ov:
                    c["overlay"] = ""

        # ※ 単体不可コンボの usable 強制 True は
        # ここでやらず sanitize側で扱う方が安全

    # incomingCards もDBと概算攻撃を付与（必要なら）
    for c in s.get("incomingCards", []):
        info = lookup_card_db(c["name"]) or None
        c["db"] = info
        idx = c.get("index", 0)
        real_c = next((x for x in state.incomingCards if x.index == idx), None)
        c["approx_attack"] = approx_incoming_attack(real_c) if real_c else 0

    return mask_enemy_if_me_is_kiri(s)


def decide_with_llm(state: GFState) -> Action:
    llm_input = build_llm_state(state)
    key = phase_key(state.phase)
    phase_prompt = PHASE_PROMPTS.get(key, "")

    try:
        resp = client.chat.completions.create(
            model=os.getenv("GF_MODEL", "gpt-5.1"),
            messages=[
                {"role": "system", "content": SYSTEM_CORE},
                {"role": "system", "content": phase_prompt},
                {"role": "user", "content": json.dumps(
                    llm_input, ensure_ascii=False)},
            ],
            # temperature=0.0
        )
        raw_txt = resp.choices[0].message.content.strip()
        json_txt = raw_txt
        if "```json" in raw_txt:
            json_txt = raw_txt.split("```json")[1].split("```")[0].strip()
        elif "```" in raw_txt:
            json_txt = raw_txt.split("```")[0].strip()
        data = json.loads(json_txt)
    except Exception as e:
        print(f"[GF LLM ERROR] {e}")
        return decide_rule_based(state)

    atype = data.get("type", "none")
    raw_indices = data.get("cardIndices", [])
    reason = data.get("reason", "No reason")
    exchange = data.get("exchange")
    buy = data.get("buy")
    target = data.get("target")
    if target not in ("enemy", "self"):
        target = None

    if atype == "defense":
        atype = "defend"
    if atype == "buy_choice" or atype == "buy-choice":
        atype = "buy_choice"
    if not isinstance(raw_indices, list):
        raw_indices = []

    hand_indices = {c.index for c in state.hand}
    valid_indices = [i for i in raw_indices if i in hand_indices]
    valid_indices = adjust_sell_for_lethal(atype, valid_indices, state)

    # ルール適用
    final_type, final_indices, correction_logs = sanitize_strict_rules(
        atype, valid_indices, state)

    fallback_msg = ""
    if atype == "attack" and not final_indices:
        fallback = choose_attack_capable_weapon(state)
        if fallback:
            final_type, final_indices = "attack", fallback
            fallback_msg = "【FALLBACK】攻撃案無効化 -> 最強武器自動選択"
        else:
            final_type = "attack-pass"
            fallback_msg = "【FALLBACK】攻撃案無効化 -> パス"

    if atype == "defend" and not final_indices:
        final_type = "defense-pass"
        fallback_msg = "【FALLBACK】防御案無効化 -> パス"

    # ex_obj 生成（ログより先に）
    ex_obj = None
    if exchange and (final_type == "exchange" or any(c.name == "両替" for c in state.hand if c.index in final_indices)):
        try:
            raw_plan = ExchangePlan(**exchange)
            ex_obj = normalize_exchange_plan(raw_plan, state.me)
        except:
            pass

    # 両替なのにプランがない場合のフォールバック
    if ex_obj is None and (final_type == "exchange" or any(c.name == "両替" for c in state.hand if c.index in final_indices)):
        ex_obj = ExchangePlan(
            hp=state.me.hp, mp=state.me.mp, gold=state.me.gold)

    buy_val = None
    if final_type == "buy_choice":
        try:
            buy_val = int(buy)
        except:
            buy_val = 0
        if buy_val not in (0, 1):
            buy_val = 0

    # === LOG GENERATION ===
    raw_names = get_card_name(raw_indices, state.hand)
    final_names = get_card_name(final_indices, state.hand)

    log_blocks = []
    log_blocks.append(f"★ PromptKey: {key}")
    log_blocks.append(
        f"================ [TURN {_TURN_COUNTER}] Phase: {state.phase} ================")
    log_blocks.append(format_state_for_log(state, GAME_HISTORY))
    log_blocks.append("-" * 50)
    log_blocks.append(f"★ AI Output (Raw):")
    log_blocks.append(f"   Type: {atype}")
    log_blocks.append(f"   Cards: {raw_indices} => {raw_names}")
    log_blocks.append(f"   Reason: {reason}")
    if exchange:
        log_blocks.append(f"   Exchange: {exchange}")
    if buy is not None:
        log_blocks.append(f"   Buy: {buy}")

    if correction_logs:
        log_blocks.append(f"\n★ Python Corrections:")
        for l in correction_logs:
            log_blocks.append(f"   [FIX] {l}")

    if fallback_msg:
        log_blocks.append(f"\n★ {fallback_msg}")

    if raw_indices != final_indices or atype != final_type:
        log_blocks.append(f"\n★ Final Action:")
        log_blocks.append(f"   Type: {final_type}")
        log_blocks.append(f"   Cards: {final_indices} => {final_names}")
        if ex_obj:
            log_blocks.append(f"   Exchange Plan: {ex_obj}")

    log_blocks.append("\n" + "="*60 + "\n")
    write_debug_log("\n".join(log_blocks))
    # =======================

    return Action(
        type=final_type,
        cardIndices=final_indices,
        reason=reason,
        buy=buy_val,
        exchange=ex_obj,
        target=target,
    )


@app.post("/decide", response_model=Action)
def decide(state: GFState):
    global _LAST_ACTION
    update_history(state)
    print(f"[GF REQ] Phase: {state.phase}")

    valid_phases = ["attack", "defense", "buy-choice", "buy_choice"]
    if state.phase not in valid_phases:
        return Action(type="none", reason="Ignored phase")

    if os.getenv("USE_LLM", "true").lower() == "true":
        action = decide_with_llm(state)
    else:
        action = decide_rule_based(state)

    _LAST_ACTION = action
    print(f"[GF ACT] {action.type} {action.cardIndices}")
    return action
