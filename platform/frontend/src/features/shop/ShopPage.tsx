import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "../../services/api";
import {
  applyFx,
  applySkin,
  applyTermTheme,
  getLook,
  setLook,
  shopDisplayName,
  type LookKind,
} from "../../services/lookPreferences";
import {
  parseShopBuy,
  parseWallet,
  type ShopItem,
  type WalletPayload,
} from "../../services/parse";
import { showToast } from "../../services/toast";
import { notifySetsUnlocked } from "../../services/claimAchievements";
import { emitDrops } from "../../services/walletEvents";

type LookGroup = {
  title: string;
  kind: string;
  note: string;
  cls: string;
  icon: string;
};

const LOOK_GROUPS: LookGroup[] = [
  {
    title: "Небо",
    kind: "sky",
    note: "Атмосфера всей платформы",
    cls: "shop-section-sky",
    icon: "~",
  },
  {
    title: "Эффекты",
    kind: "fx",
    note: "ASCII-символы поверх неба, цвет под скин",
    cls: "shop-section-fx",
    icon: "*~",
  },
  {
    title: "Терминал",
    kind: "term",
    note: "Тема редактора и вывода кода",
    cls: "shop-section-term",
    icon: ">_",
  },
];

const STATUS_GROUPS: LookGroup[] = [
  {
    title: "Титулы",
    kind: "title",
    note: "Носится рядом с именем",
    cls: "shop-section-title",
    icon: "«»",
  },
  {
    title: "Профиль",
    kind: "premium",
    note: "Расширяет возможности доски проектов",
    cls: "shop-section-premium",
    icon: "^",
  },
  {
    title: "Полезное",
    kind: "consumable",
    note: "Работает автоматически",
    cls: "shop-section-consumable",
    icon: "[+]",
  },
];

type PreviewSnap = { sky: string | null; term: string | null; fx: string | null };

function catalogByKind(
  shop: Record<string, ShopItem>,
  kind: string,
): Array<[string, ShopItem]> {
  return Object.entries(shop).filter(([, i]) => (i.kind || "") === kind);
}

function markFor(kind: string, fallback: string): string {
  if (kind === "sky") return "~";
  if (kind === "term") return ">_";
  if (kind === "title") return "«»";
  if (kind === "premium") return "^";
  if (kind === "fx") return "*~";
  return fallback;
}

export function ShopPage() {
  const [wallet, setWallet] = useState<WalletPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [fxScale, setFxScale] = useState(() =>
    Math.round(+(getLook("fx_scale") || "1.1") * 100),
  );
  const [fxDens, setFxDens] = useState(() =>
    Math.round(+(getLook("fx_density") || "1") * 100),
  );
  const previewTimer = useRef(0);
  const previewSnap = useRef<PreviewSnap | null>(null);

  const reload = useCallback(async () => {
    const w = await apiGet("/api/wallet", parseWallet);
    setWallet(w);
    emitDrops(w.drops);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Ошибка");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [reload]);

  function restorePreview() {
    const s = previewSnap.current;
    if (!s) return;
    window.clearTimeout(previewTimer.current);
    previewTimer.current = 0;
    previewSnap.current = null;
    if (s.sky) {
      setLook("sky", s.sky);
      applySkin(s.sky);
    } else {
      setLook("sky", "");
      applySkin("");
    }
    if (s.term) {
      setLook("term", s.term);
      applyTermTheme(s.term);
    } else {
      setLook("term", "");
      applyTermTheme("");
    }
    if (s.fx) {
      setLook("fx", s.fx);
      applyFx(s.fx);
    } else {
      setLook("fx", "");
      applyFx("");
    }
    setTick((n) => n + 1);
  }

  function startPreview(kind: string, key: string) {
    if (!previewSnap.current) {
      previewSnap.current = {
        sky: getLook("sky"),
        term: getLook("term"),
        fx: getLook("fx"),
      };
    }
    window.clearTimeout(previewTimer.current);
    if (kind === "sky") applySkin(key || "");
    else if (kind === "term") applyTermTheme(key || "");
    else if (kind === "fx") applyFx(key || "");
    showToast("Предпросмотр · 8 секунд, затем вернём ваш вид");
    previewTimer.current = window.setTimeout(restorePreview, 8000);
  }

  function applyLook(kind: LookKind, key: string) {
    setLook(kind, key);
    if (kind === "sky") applySkin(key);
    else if (kind === "term") applyTermTheme(key);
    else if (kind === "fx") applyFx(key);
    setTick((n) => n + 1);
  }

  async function buy(item: string) {
    setBusyItem(item);
    try {
      const r = await apiPost("/api/shop/buy", { item }, parseShopBuy);
      emitDrops(r.drops);
      showToast("Покупка совершена!");
      notifySetsUnlocked(r.sets_unlocked);
      await reload();
      setTick((n) => n + 1);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Не удалось купить";
      showToast(msg);
    } finally {
      setBusyItem(null);
    }
  }

  function renderActions(key: string, item: ShopItem, icon: string) {
    void icon;
    void tick;
    if (!wallet) return null;
    const owned = wallet.owned.includes(key);
    const kind = item.kind || "";
    const preview =
      kind === "sky" || kind === "term" || kind === "fx" ? (
        <button
          type="button"
          className="btn shop-preview"
          onClick={() => startPreview(kind, key)}
        >
          Смотреть
        </button>
      ) : null;

    if (key === "freeze") {
      return (
        <>
          <button
            type="button"
            className="btn shop-buy"
            disabled={busyItem === "freeze"}
            onClick={() => void buy("freeze")}
          >
            Купить · {item.price}
          </button>
          <span className="shop-owned">в запасе: {wallet.freezes}</span>
        </>
      );
    }

    if (!owned) {
      return (
        <>
          {preview}
          <button
            type="button"
            className="btn shop-buy"
            disabled={busyItem === key}
            onClick={() => void buy(key)}
          >
            Купить · {item.price}
          </button>
        </>
      );
    }

    if (kind === "sky" || kind === "term" || kind === "fx" || kind === "title") {
      const lookKind = kind as LookKind;
      const active = getLook(lookKind) === key;
      const clearLabel =
        kind === "sky"
          ? "Вернуть день"
          : kind === "term"
            ? "Сбросить"
            : kind === "title"
              ? "Снять"
              : "Выключить";
      const applyLabel =
        kind === "title" ? "Надеть" : kind === "fx" ? "Включить" : "Применить";
      const ownedLabel =
        kind === "sky"
          ? "применён"
          : kind === "term"
            ? "применена"
            : kind === "title"
              ? "носится"
              : "включён";
      return (
        <>
          {preview}
          {active ? (
            <>
              <button
                type="button"
                className="btn shop-apply"
                onClick={() => applyLook(lookKind, "")}
              >
                {clearLabel}
              </button>
              <span className="shop-owned">{ownedLabel}</span>
            </>
          ) : (
            <button
              type="button"
              className="btn dark shop-apply"
              onClick={() => applyLook(lookKind, key)}
            >
              {applyLabel}
            </button>
          )}
        </>
      );
    }

    return <span className="shop-owned">куплено</span>;
  }

  function section(gr: LookGroup, items: Array<[string, ShopItem]>) {
    if (!items.length) return null;
    return (
      <div className={`pane shop-section ${gr.cls}`} key={gr.kind}>
        <div className="shop-section-head">
          <span className="shop-section-mark" aria-hidden="true">
            {gr.icon}
          </span>
          <div>
            <h3>{gr.title}</h3>
            <p className="stat-note">{gr.note}</p>
          </div>
        </div>
        <div className="shop-list">
          {items.map(([key, item]) => (
            <div
              key={key}
              className={`shop-item${wallet?.owned.includes(key) ? " owned" : ""}`}
            >
              <span className="shop-icon">
                {markFor(item.kind || "", gr.icon)}
              </span>
              <span className="shop-name">
                {shopDisplayName(item.title, item.kind || "")}
              </span>
              <span className="shop-actions">
                {renderActions(key, item, gr.icon)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="task-page shop-page">
        <div className="empty">{error}</div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="task-page shop-page">
        <div className="empty">Загружаю магазин…</div>
      </div>
    );
  }

  const setItems = Object.entries(wallet.set_items).filter(
    ([k]) => !wallet.shop[k] && wallet.owned.includes(k),
  );

  return (
    <div className="task-page shop-page">
      <div className="task-nav">
        <div className="crumbs">
          <Link to="/">Главная</Link> / Магазин
        </div>
        <span className="drops-pill big">
          <span className="drop-dot" />
          {wallet.drops}
        </span>
      </div>

      <section className="pane shop-hero">
        <span className="project-kicker">Капли</span>
        <h2>Магазин</h2>
        <p>
          Сначала оформление платформы, затем титулы и полезности. Цены сервисов
          и награды за комплекты — внизу.
        </p>
      </section>

      <section className="shop-zone">
        <header className="shop-zone-head">
          <h3>Оформление</h3>
          <p>Небо, эффекты и терминал меняют вид всей платформы</p>
        </header>
        <div className="shop-zone-body shop-zone-look">
          {LOOK_GROUPS.map((gr) =>
            section(gr, catalogByKind(wallet.shop, gr.kind)),
          )}
          {wallet.owned.includes("fx_leaves") ? (
            <div className="pane shop-section shop-section-fx shop-fx-tune">
              <div className="shop-section-head">
                <span className="shop-section-mark" aria-hidden="true">
                  *~
                </span>
                <div>
                  <h3>Настройка символов</h3>
                  <p className="stat-note">Доступно после покупки эффекта</p>
                </div>
              </div>
              <div className="shop-fx-sliders">
                <label className="shop-fx-slider">
                  Размер
                  <input
                    type="range"
                    min={100}
                    max={130}
                    step={5}
                    value={fxScale}
                    onChange={(e) => {
                      const v = +e.target.value;
                      setFxScale(v);
                      setLook("fx_scale", (v / 100).toFixed(2));
                      window.__leavesRespawn?.();
                    }}
                  />
                  <span>{fxScale}%</span>
                </label>
                <label className="shop-fx-slider">
                  Густота
                  <input
                    type="range"
                    min={90}
                    max={130}
                    step={5}
                    value={fxDens}
                    onChange={(e) => {
                      const v = +e.target.value;
                      setFxDens(v);
                      setLook("fx_density", (v / 100).toFixed(2));
                      window.__leavesRespawn?.();
                    }}
                  />
                  <span>{fxDens}%</span>
                </label>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="shop-zone">
        <header className="shop-zone-head">
          <h3>Статус и полезности</h3>
          <p>Титул у имени, премиум-профиль и заморозка серии</p>
        </header>
        <div className="shop-zone-body shop-zone-status">
          {STATUS_GROUPS.map((gr) =>
            section(gr, catalogByKind(wallet.shop, gr.kind)),
          )}
        </div>
      </section>

      <section className="shop-zone">
        <header className="shop-zone-head">
          <h3>Справка</h3>
          <p>Что ещё тратит капли и чем награждают комплекты</p>
        </header>
        <div className="shop-zone-body shop-zone-info">
          <div className="pane shop-section shop-section-meta">
            <h3>За капли также</h3>
            <div className="stat-list">
              <div className="stat-row">
                <span className="stat-label">Подсказка «объяснение»</span>
                <span className="survey-val">5 капель</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Подсказка «полный ответ»</span>
                <span className="survey-val">15 капель</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">
                  Вопрос ИИ сверх 3 бесплатных в день
                </span>
                <span className="survey-val">5 капель</span>
              </div>
            </div>
            <p className="stat-note">
              Ревью ваших попыток от наставника — всегда бесплатно.
            </p>
          </div>
          {setItems.length ? (
            <div className="pane shop-section shop-section-meta">
              <h3>Награды за комплекты</h3>
              <div className="shop-list">
                {setItems.map(([k, title]) => {
                  const kind = k.startsWith("title")
                    ? "title"
                    : k.startsWith("sky")
                      ? "sky"
                      : "term";
                  return (
                    <div key={k} className="shop-item owned">
                      <span className="shop-icon">{markFor(kind, "[+]")}</span>
                      <span className="shop-name">
                        {shopDisplayName(title, kind)}
                      </span>
                      <span className="shop-actions">
                        {renderActions(k, { price: 0, title, kind }, "")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="pane shop-section shop-section-meta">
              <h3>Награды за комплекты</h3>
              <p className="stat-note">
                Собирайте наборы достижений — за них выдаются уникальные титулы,
                тема терминала и небо «Космос». Прогресс смотрите в профиле.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
