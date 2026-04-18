// ============================================================
// frontend/src/components/ExportModal.jsx
// Modal export Excel — sélection fermes + période
// ============================================================

import React, { useState, useEffect, useRef } from "react";

import { createPortal } from "react-dom";
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  Calendar,
  MoveRight,
  SquareMousePointer,
} from "lucide-react";

const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
const DAYS_FR = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];

// ── Range Calendar ────────────────────────────────────────────
export function RangeCalendar({
  dateFrom,
  dateTo,
  onChangeFrom,
  onChangeTo,
  onClose,
  C,
  singleMonth = false,
}) {
  const today = new Date();
  const [leftYear, setLeftYear] = useState(today.getFullYear());
  const [leftMonth, setLeftMonth] = useState(today.getMonth());
  const [hovering, setHovering] = useState(null);
  const [modeLeft, setModeLeft] = useState("days");
  const [modeRight, setModeRight] = useState("days");

  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;

  const prevLeft = () => {
    if (leftMonth === 0) {
      setLeftMonth(11);
      setLeftYear((y) => y - 1);
    } else setLeftMonth((m) => m - 1);
  };
  const nextLeft = () => {
    if (leftMonth === 11) {
      setLeftMonth(0);
      setLeftYear((y) => y + 1);
    } else setLeftMonth((m) => m + 1);
  };

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const handleDay = (dateStr) => {
    if (!dateFrom || (dateFrom && dateTo)) {
      onChangeFrom(dateStr);
      onChangeTo("");
    } else {
      if (dateStr < dateFrom) {
        onChangeTo(dateFrom);
        onChangeFrom(dateStr);
      } else onChangeTo(dateStr);
    }
  };

  const isInRange = (dateStr) => {
    const end = dateTo || hovering;
    if (!dateFrom || !end) return false;
    const lo = dateFrom < end ? dateFrom : end;
    const hi = dateFrom < end ? end : dateFrom;
    return dateStr > lo && dateStr < hi;
  };

  const buildCells = (year, month) => {
    let startDow = new Date(year, month, 1).getDay() - 1;
    if (startDow < 0) startDow = 6;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++)
      cells.push({ day: daysInPrev - startDow + 1 + i, curr: false });
    for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, curr: true });
    while (cells.length % 7 !== 0)
      cells.push({
        day: cells.length - startDow - daysInMonth + 1,
        curr: false,
      });
    return cells;
  };

  const MonthGrid = ({ year, month, mode, setMode, setYear, setMonth }) => {
    const cells = buildCells(year, month);
    const years = Array.from({ length: 12 }, (_, i) => year - 5 + i);
    const btnStyle = {
      background: "none",
      border: "1px solid transparent",
      borderRadius: 6,
      cursor: "pointer",
      color: C.text,
      fontSize: 12,
      fontWeight: 800,
      fontFamily: "inherit",
      padding: "2px 6px",
    };
    return (
      <div style={{ flex: 1 }}>
        {/* Header mois/année cliquables */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            marginBottom: 10,
          }}
        >
          <button
            onClick={() => setMode((m) => (m === "months" ? "days" : "months"))}
            style={{
              ...btnStyle,
              background: mode === "months" ? `${C.green}15` : "none",
              border:
                mode === "months"
                  ? `1px solid ${C.green}40`
                  : "1px solid transparent",
            }}
          >
            {MONTHS_FR[month].slice(0, 3)}
          </button>
          <button
            onClick={() => setMode((m) => (m === "years" ? "days" : "years"))}
            style={{
              ...btnStyle,
              background: mode === "years" ? `${C.green}15` : "none",
              border:
                mode === "years"
                  ? `1px solid ${C.green}40`
                  : "1px solid transparent",
            }}
          >
            {year}
          </button>
        </div>

        {/* Year picker */}
        {mode === "years" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 3,
              marginBottom: 6,
            }}
          >
            {years.map((y) => (
              <button
                key={y}
                onClick={() => {
                  setYear(y);
                  setMode("months");
                }}
                style={{
                  background: y === year ? C.green : "transparent",
                  border: `1px solid ${y === year ? C.green : C.border}`,
                  borderRadius: 6,
                  cursor: "pointer",
                  color: y === year ? "#fff" : C.text,
                  fontSize: 11,
                  fontWeight: y === year ? 800 : 400,
                  fontFamily: "inherit",
                  padding: "5px 2px",
                }}
              >
                {y}
              </button>
            ))}
          </div>
        )}

        {/* Month picker */}
        {mode === "months" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 3,
              marginBottom: 6,
            }}
          >
            {MONTHS_FR.map((mn, mi) => (
              <button
                key={mn}
                onClick={() => {
                  setMonth(mi);
                  setMode("days");
                }}
                style={{
                  background: mi === month ? C.green : "transparent",
                  border: `1px solid ${mi === month ? C.green : C.border}`,
                  borderRadius: 6,
                  cursor: "pointer",
                  color: mi === month ? "#fff" : C.text,
                  fontSize: 11,
                  fontWeight: mi === month ? 800 : 400,
                  fontFamily: "inherit",
                  padding: "5px 2px",
                }}
              >
                {mn.slice(0, 3)}
              </button>
            ))}
          </div>
        )}

        {/* Days grid */}
        {mode === "days" && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,1fr)",
                marginBottom: 4,
              }}
            >
              {DAYS_FR.map((d) => (
                <div
                  key={d}
                  style={{
                    textAlign: "center",
                    fontSize: 9,
                    fontWeight: 700,
                    color: C.textDim,
                    padding: "2px 0",
                    textTransform: "uppercase",
                  }}
                >
                  {d}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,1fr)",
                gap: "2px 0",
              }}
            >
              {cells.map((cell, i) => {
                if (!cell.curr) return <div key={i} />;
                const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
                const start = ds === dateFrom;
                const end = ds === dateTo;
                const inRange = isInRange(ds);
                const isT = ds === todayStr;
                return (
                  <div
                    key={i}
                    onClick={() => handleDay(ds)}
                    onMouseEnter={() => dateFrom && !dateTo && setHovering(ds)}
                    onMouseLeave={() => setHovering(null)}
                    style={{
                      textAlign: "center",
                      fontSize: 11,
                      padding: "6px 0",
                      cursor: "pointer",
                      background:
                        start || end
                          ? C.green
                          : inRange
                            ? `${C.green}25`
                            : "transparent",
                      color: start || end ? "#fff" : isT ? C.green : C.text,
                      fontWeight: start || end ? 800 : isT ? 700 : 400,
                      borderRadius: start
                        ? "6px 0 0 6px"
                        : end
                          ? "0 6px 6px 0"
                          : inRange
                            ? 0
                            : 6,
                      transition: "background 0.1s",
                      position: "relative",
                    }}
                  >
                    {isT && !start && !end && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 1,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 3,
                          height: 3,
                          borderRadius: "50%",
                          background: C.green,
                        }}
                      />
                    )}
                    {cell.day}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  // Setter mois droit → on recalcule depuis le mois gauche
  const setRightYear = (y) => setLeftYear(leftMonth === 11 ? y - 1 : y);
  const setRightMonth = (m) => {
    if (m === 0) {
      setLeftMonth(11);
      setLeftYear((y) => y - 1);
    } else setLeftMonth(m - 1);
  };

  return (
    <div>
      {/* Navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <button
          onClick={prevLeft}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: C.textMuted,
            padding: "4px 8px",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
        </button>
        <div
          style={{
            display: "flex",
            gap: 32,
            flex: 1,
            justifyContent: "space-around",
          }}
        >
          <MonthGrid
            year={leftYear}
            month={leftMonth}
            mode={modeLeft}
            setMode={setModeLeft}
            setYear={setLeftYear}
            setMonth={setLeftMonth}
          />
          {!singleMonth && (
            <>
              <div style={{ width: 1, background: C.border }} />
              <MonthGrid
                year={rightYear}
                month={rightMonth}
                mode={modeRight}
                setMode={setModeRight}
                setYear={setRightYear}
                setMonth={setRightMonth}
              />
            </>
          )}
        </div>
        <button
          onClick={nextLeft}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: C.textMuted,
            padding: "4px 8px",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* Shortcuts */}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {[
          {
            label: "Aujourd'hui",
            action: () => {
              onChangeFrom(todayStr);
              onChangeTo(todayStr);
            },
          },
          {
            label: "7 derniers jours",
            action: () => {
              const t = new Date();
              const f = new Date();
              f.setDate(f.getDate() - 6);
              const fmt = (d) =>
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              onChangeFrom(fmt(f));
              onChangeTo(fmt(t));
            },
          },
          {
            label: "Ce mois",
            action: () => {
              const t = new Date();
              onChangeFrom(
                `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`,
              );
              onChangeTo(
                `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()).padStart(2, "0")}`,
              );
            },
          },
          {
            label: "Effacer",
            action: () => {
              onChangeFrom("");
              onChangeTo("");
              onClose();
            },
          },
        ].map((s) => (
          <button
            key={s.label}
            onClick={s.action}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.textMuted,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main ExportModal ──────────────────────────────────────────
export default function ExportModal({ token, auth, farms, C, dark, onClose, isMobile, isTablet }) {
  const [selectedFarms, setSelectedFarms] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [showCal, setShowCal] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const calTriggerRef = useRef(null);
  const [calPos, setCalPos] = useState({});
  const [modeLeft, setModeLeft] = useState("days");
  const [modeRight, setModeRight] = useState("days");

  // Ajouter après les useState existants
  const dropRef = useRef(null);
  const calPortalRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      // Fermer dropdown fermes
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setDropOpen(false);
      }
      // Fermer calendrier
      if (
        calTriggerRef.current &&
        !calTriggerRef.current.contains(e.target) &&
        calPortalRef.current &&
        !calPortalRef.current.contains(e.target)
      ) {
        setShowCal(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fermes autorisées
  const isAdmin = auth?.role === "admin";
  const allowedFarms = isAdmin
    ? farms.map((f) => f.farm_name)
    : auth?.farm_names || [];

  const toggleFarm = (name) => {
    setSelectedFarms((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  };

  const fmtDisplay = (d) =>
    d
      ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : "—";

  const canExport = selectedFarms.length > 0 && dateFrom && dateTo;

  const handleExport = async () => {
    if (!canExport) return;
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams({
        farm_names: selectedFarms.join(","),
        date_from: dateFrom,
        date_to: dateTo,
      });
      const res = await fetch(`/api/export/saisie?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `suivi_irrigation_${dateFrom}_${dateTo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.70)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 24,
      }}
    >
      <div
        style={{
          background: C.card,
          border: `1.5px solid ${C.border}`,
          borderRadius: 18,
          margin: isMobile ? 16 : 0, 
          width: "100%",
          maxWidth: isMobile ? "100%" : isTablet ? 560 : 820,
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          maxHeight: isMobile ? "90vh" : "92vh",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isMobile ? "14px 16px" : "20px 28px",
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `${C.green}15`,
                border: `1.5px solid ${C.green}30`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Download size={18} color={C.green} strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
                Export Excel — Suivi d'irrigation
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                Sélectionnez les fermes et la période à exporter
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.textDim,
              padding: 4,
            }}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: isMobile ? "16px 16px" : "24px 28px" }}>
          {/* Sélection fermes */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 630,
                textTransform: "uppercase",
                letterSpacing: "0em",
                color: C.textMuted,
                marginBottom: 10,
              }}
            >
              Fermes à exporter
              {isAdmin && (
                <span
                  style={{
                    color: C.textDim,
                    fontWeight: 400,
                    marginLeft: 6,
                    textTransform: "none",
                  }}
                >
                  (plusieurs possible)
                </span>
              )}
            </div>
            <div ref={dropRef} style={{ position: "relative" }}>
              <div
                onClick={() => setDropOpen((v) => !v)}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 36,
                  padding: "4px 36px 4px 15px",
                  border: `1.5px solid ${dropOpen ? C.green : C.border}`,
                  borderRadius: 8,
                  background: C.inputBg,
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
              >
                {selectedFarms.length === 0 && (
                  <span
                    style={{ color: C.textDim, fontSize: 12, fontWeight: 630 }}
                  >
                    <SquareMousePointer
                      size={15}
                      color={C.textDim}
                      strokeWidth={2}
                      style={{ marginRight: 8.5,  marginTop: 1, }}
                    />
                    Sélectionner une ferme
                  </span>
                )}
                {selectedFarms.map((f) => (
                  <span
                    key={f}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: `${C.green}20`,
                      color: C.green,
                      border: `1px solid ${C.green}40`,
                      borderRadius: 5,
                      padding: "2px 6px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {f}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFarms((prev) => prev.filter((x) => x !== f));
                      }}
                      style={{
                        cursor: "pointer",
                        opacity: 0.7,
                        fontSize: 12,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </span>
                  </span>
                ))}
                <div
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {selectedFarms.length > 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFarms([]);
                      }}
                      style={{
                        cursor: "pointer",
                        color: C.textDim,
                        display: "flex",
                      }}
                    >
                      <X size={12} strokeWidth={2} />
                    </span>
                  )}
                  {dropOpen ? (
                    <ChevronUp size={12} strokeWidth={2} color={C.textDim} />
                  ) : (
                    <ChevronDown size={12} strokeWidth={2} color={C.textDim} />
                  )}
                </div>
              </div>
              {dropOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: C.card,
                    border: `1.5px solid ${C.border}`,
                    borderRadius: 8,
                    zIndex: 200,
                    boxShadow: `0 4px 20px ${C.shadow}`,
                    maxHeight: 180,
                    overflowY: "auto",
                  }}
                >
                  {allowedFarms.filter((f) => !selectedFarms.includes(f))
                    .length === 0 ? (
                    <div
                      style={{
                        padding: "10px 14px",
                        color: C.textDim,
                        fontSize: 12,
                      }}
                    >
                      Toutes les fermes sélectionnées
                    </div>
                  ) : (
                    allowedFarms
                      .filter((f) => !selectedFarms.includes(f))
                      .map((f) => (
                        <div
                          key={f}
                          onClick={() => {
                            setSelectedFarms((prev) =>
                              isAdmin ? [...prev, f] : [f],
                            );
                            if (!isAdmin) setDropOpen(false);
                          }}
                          style={{
                            padding: "9px 14px",
                            fontSize: 12,
                            color: C.textMuted,
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = C.tableHover)
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          {f}
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Période */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 630,
                textTransform: "uppercase",
                letterSpacing: "0em",
                color: C.textMuted,
                marginBottom: 10,
              }}
            >
              Période
            </div>
            <div
              ref={calTriggerRef}
              onClick={() => {
                const r = calTriggerRef.current.getBoundingClientRect();
                setCalPos({ top: r.bottom + 6, left: r.left, width: r.width });
                setShowCal((v) => !v);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                borderRadius: 8,
                minHeight: 36,
                cursor: "pointer",
                border: `1.5px solid ${showCal ? C.green : C.border}`,
                background: C.inputBg,
                transition: "border-color 0.15s",
              }}
            >
              <Calendar
                size={15}
                color={showCal || dateFrom ? C.green : C.textDim}
                strokeWidth={2}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 630,
                  color: dateFrom ? C.green : C.textDim,
                  minWidth: 70,
                  textAlign: "center",
                }}
              >
                {dateFrom ? fmtDisplay(dateFrom) : "Date début"}
              </span>
              <MoveRight size={14} strokeWidth={2} color={C.textDim} />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 630,
                  color: dateTo ? C.green : C.textDim,
                  minWidth: 60,
                  textAlign: "center",
                }}
              >
                {dateTo ? fmtDisplay(dateTo) : "Date fin"}
              </span>
              {dateFrom && dateTo && (
                <span
                  style={{ fontSize: 11, color: C.textDim, marginLeft: "auto" }}
                >
                  {Math.round(
                    (new Date(dateTo) - new Date(dateFrom)) / 86400000,
                  ) + 1}{" "}
                  jours
                </span>
              )}
            </div>
          </div>

          {/* Calendrier en portal — au-dessus du modal */}
          {showCal && (isMobile || isTablet) && (
            <div style={{
              marginTop: 8,
              border: `1.5px solid ${C.border}`,
              borderRadius: 12,
              padding: "16px 12px",
              background: dark ? C.surface : "#fafcfb",
            }}>
              <RangeCalendar
                dateFrom={dateFrom}
                dateTo={dateTo}
                onChangeFrom={setDateFrom}
                onChangeTo={(d) => { setDateTo(d); if (d) setShowCal(false); }}
                C={C}
                onClose={() => setShowCal(false)}
                singleMonth={true}
              />
            </div>
          )}

          {showCal && !isMobile && !isTablet &&
            createPortal(
              <div
                ref={calPortalRef}
                style={{
                  position: "fixed",
                  top: calPos.top,
                  left: calPos.left,
                  width: calPos.width,
                  zIndex: 999999,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "16px 20px",
                  background: dark ? C.surface : "#fafcfb",
                  boxShadow: `0 8px 32px rgba(0,0,0,0.35)`,
                }}
              >
                <RangeCalendar
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onChangeFrom={setDateFrom}
                  onChangeTo={(d) => { setDateTo(d); if (d) setShowCal(false); }}
                  C={C}
                  onClose={() => setShowCal(false)}
                />
              </div>,
              document.body,
            )}

          {/* Résumé export */}
          {canExport && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                background: `${C.green}08`,
                border: `1px solid ${C.green}25`,
                fontSize: 12,
                color: C.textMuted,
                marginBottom: 16,
              }}
            >
              Export :{" "}
              <strong style={{ color: C.green }}>
                {selectedFarms.join(", ")}
              </strong>{" "}
              du{" "}
              <strong style={{ color: C.text }}>{fmtDisplay(dateFrom)}</strong>{" "}
              au <strong style={{ color: C.text }}>{fmtDisplay(dateTo)}</strong>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 8,
                background: dark ? "#2a0a0a" : "#fef2f2",
                border: `1px solid ${C.red}30`,
                color: C.red,
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              <AlertCircle size={14} strokeWidth={2} />
              {error}
            </div>
          )}

          {/* Boutons */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={onClose}
              style={{
                padding: "10px 20px",
                borderRadius: 9,
                border: `1.5px solid ${C.border}`,
                background: "transparent",
                color: C.textMuted,
                fontSize: 12,
                fontWeight: 630, marginTop: isMobile ? 20 : 0,
                fontFamily: "inherit",
                cursor: "pointer",
                minHeight: 32,
              }}
            >
              Annuler
            </button>
            <button
              onClick={handleExport}
              disabled={!canExport || exporting}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 24px",
                borderRadius: 9,
                background: canExport && !exporting ? C.green : C.toggleBg,
                color: canExport && !exporting ? "#fff" : C.textDim,
                border: "none",
                fontSize: 12,
                fontWeight: 630, marginTop: isMobile ? 20 : 0,
                minHeight: 32,
                fontFamily: "inherit",
                cursor: canExport && !exporting ? "pointer" : "not-allowed",
                transition: "all 0.15s",
              }}
            >
              <Download size={14} strokeWidth={2.5} />
              {exporting ? "Export en cours..." : "Exporter Excel"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
