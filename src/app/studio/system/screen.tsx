import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { accessDenied } from "@/app/studio/access";
import { StudioLoading } from "@/app/studio/studio-loading";
import { ReplayMotion } from "@/app/studio/system/replay";
import { V3_CONTENT_ID, V3Frame } from "@/app/v3/frame";
import type { InterfaceLocale } from "@/i18n/locales";
import { studioWords } from "@/i18n/studio";
import { v3StringsFor } from "@/i18n/v3";
import { authorizeAuthor } from "@/modules/identity";

// The design system's living catalogue (the reference's "System" screen),
// private to the author: the paper and inks, the four faces, the objects,
// the motion and sound vocabularies, the rules, and the grid, drawn with the
// same classes as the pages. Its samples are stand-ins, never the author's
// words and never the reference's example photographs or covers.
export function systemMetadata(locale: InterfaceLocale): Metadata {
  return { title: studioWords(locale).meta.system };
}

export function SystemScreen({ locale }: { locale: InterfaceLocale }) {
  return (
    <Suspense fallback={<StudioLoading locale={locale} />}>
      <System locale={locale} />
    </Suspense>
  );
}

async function System({ locale }: { locale: InterfaceLocale }) {
  // The authorization boundary: nothing below renders otherwise.
  const authorization = await authorizeAuthor(await headers());
  if (!authorization.ok) {
    return accessDenied(authorization.reason, locale);
  }
  const t = v3StringsFor(locale).system;
  const w = studioWords(locale).system;
  return (
    <V3Frame locale={locale} path="/studio/system" page="system">
      <main id={V3_CONTENT_ID} tabIndex={-1}>
        <section className="ptop wrap" aria-labelledby="pp-h1">
          <div className="shead">
            <h1 id="pp-h1" data-a="up" data-d="0">
              {t.h1}
              <span className="ser">{t.h1b}</span>
            </h1>
          </div>
          <p className="say" data-a="up" data-d="2">
            {t.say}
          </p>
          <nav className="idxs" aria-label={t.h1} data-a="fade" data-d="4">
            <a href="#pp-s1">
              <span className="n">01</span>
              {t.s1}
            </a>
            <a href="#pp-s2">
              <span className="n">02</span>
              {t.s2}
            </a>
            <a href="#pp-s3">
              <span className="n">03</span>
              {t.s3}
            </a>
            <a href="#pp-s4">
              <span className="n">04</span>
              {t.s4}
            </a>
            <a href="#pp-s5">
              <span className="n">05</span>
              {t.s5}
            </a>
            <a href="#pp-s6">
              <span className="n">06</span>
              {t.s6}
            </a>
            <a href="#pp-s7">
              <span className="n">07</span>
              {t.s7}
            </a>
          </nav>
        </section>
        <section className="sx wrap" id="pp-s1" aria-labelledby="pp-sh1">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-sh1">
              {t.s1}
              <span className="ser">{t.s1b}</span>
            </h2>
          </div>
          <div className="chips">
            <div className="chip" data-a="pop" data-d="0">
              <span className="dot" style={{ background: "#ECE9E3" }}></span>
              <span>
                <span
                  className="kr hand"
                  style={{
                    clipPath:
                      "polygon(0.8% 0.0%,1.0% 14.3%,3.5% 28.6%,4.2% 42.9%,3.1% 57.1%,1.6% 71.4%,0.0% 85.7%,4.2% 100.0%,99.6% 100.0%,99.2% 85.7%,98.8% 71.4%,98.3% 57.1%,95.9% 42.9%,98.6% 28.6%,96.9% 14.3%,96.9% 0.0%)",
                  }}
                >
                  {t.x1}
                </span>
                <span className="hex pix">#ECE9E3</span>
                <span className="use">{t.x2}</span>
              </span>
            </div>
            <div className="chip" data-a="pop" data-d="1">
              <span className="dot" style={{ background: "#141311" }}></span>
              <span>
                <span
                  className="kr hand"
                  style={{
                    clipPath:
                      "polygon(3.7% 0.0%,2.5% 14.3%,0.6% 28.6%,2.7% 42.9%,1.2% 57.1%,2.7% 71.4%,5.0% 85.7%,2.7% 100.0%,99.8% 100.0%,99.1% 85.7%,95.5% 71.4%,99.2% 57.1%,98.1% 42.9%,99.8% 28.6%,98.4% 14.3%,98.2% 0.0%)",
                  }}
                >
                  {t.x3}
                </span>
                <span className="hex pix">#141311</span>
                <span className="use">{t.x4}</span>
              </span>
            </div>
            <div className="chip" data-a="pop" data-d="2">
              <span className="dot" style={{ background: "#8C2A22" }}></span>
              <span>
                <span
                  className="kr hand"
                  style={{
                    clipPath:
                      "polygon(3.8% 0.0%,4.0% 14.3%,0.7% 28.6%,4.5% 42.9%,4.2% 57.1%,4.1% 71.4%,3.5% 85.7%,4.8% 100.0%,95.9% 100.0%,95.5% 85.7%,97.9% 71.4%,99.6% 57.1%,95.0% 42.9%,96.3% 28.6%,95.1% 14.3%,95.9% 0.0%)",
                  }}
                >
                  {t.x5}
                </span>
                <span className="hex pix">#8C2A22</span>
                <span className="use">{t.x6}</span>
              </span>
            </div>
            <div className="chip" data-a="pop" data-d="3">
              <span className="dot" style={{ background: "#2B45C4" }}></span>
              <span>
                <span
                  className="kr hand"
                  style={{
                    clipPath:
                      "polygon(0.3% 0.0%,0.8% 14.3%,4.9% 28.6%,1.2% 42.9%,0.4% 57.1%,0.5% 71.4%,2.6% 85.7%,2.0% 100.0%,96.4% 100.0%,98.3% 85.7%,99.2% 71.4%,96.1% 57.1%,99.3% 42.9%,97.2% 28.6%,96.1% 14.3%,98.8% 0.0%)",
                  }}
                >
                  {t.x7}
                </span>
                <span className="hex pix">#2B45C4</span>
                <span className="use">{t.x8}</span>
              </span>
            </div>
            <div className="chip" data-a="pop" data-d="4">
              <span className="dot" style={{ background: "#1E2840" }}></span>
              <span>
                <span
                  className="kr hand"
                  style={{
                    clipPath:
                      "polygon(4.2% 0.0%,1.9% 14.3%,3.7% 28.6%,1.5% 42.9%,1.9% 57.1%,4.4% 71.4%,1.6% 85.7%,4.5% 100.0%,99.1% 100.0%,98.2% 85.7%,99.6% 71.4%,99.0% 57.1%,96.7% 42.9%,96.8% 28.6%,98.2% 14.3%,99.0% 0.0%)",
                  }}
                >
                  {t.x9}
                </span>
                <span className="hex pix">#1E2840</span>
                <span className="use">{t.x10}</span>
              </span>
            </div>
            <div className="chip" data-a="pop" data-d="5">
              <span className="dot" style={{ background: "#D6C29A" }}></span>
              <span>
                <span
                  className="kr hand"
                  style={{
                    clipPath:
                      "polygon(3.9% 0.0%,0.0% 14.3%,1.5% 28.6%,2.2% 42.9%,1.5% 57.1%,4.9% 71.4%,3.6% 85.7%,3.9% 100.0%,95.8% 100.0%,98.0% 85.7%,99.5% 71.4%,95.5% 57.1%,97.7% 42.9%,98.4% 28.6%,99.1% 14.3%,95.5% 0.0%)",
                  }}
                >
                  {t.x11}
                </span>
                <span className="hex pix">#D6C29A</span>
                <span className="use">{t.x12}</span>
              </span>
            </div>
            <div className="chip" data-a="pop" data-d="6">
              <span className="dot" style={{ background: "#F6F4EF" }}></span>
              <span>
                <span
                  className="kr hand"
                  style={{
                    clipPath:
                      "polygon(3.1% 0.0%,4.4% 14.3%,1.3% 28.6%,3.3% 42.9%,2.5% 57.1%,2.8% 71.4%,0.6% 85.7%,2.8% 100.0%,97.9% 100.0%,98.7% 85.7%,98.1% 71.4%,98.4% 57.1%,99.2% 42.9%,95.4% 28.6%,99.8% 14.3%,98.7% 0.0%)",
                  }}
                >
                  {t.x13}
                </span>
                <span className="hex pix">#F6F4EF</span>
                <span className="use">{t.x14}</span>
              </span>
            </div>
          </div>
        </section>
        <section className="sx wrap" id="pp-s2" aria-labelledby="pp-sh2">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-sh2">
              {t.s2}
              <span className="ser">{t.s2b}</span>
            </h2>
          </div>
          <div className="types">
            <div className="tline" data-a="up" data-d="0">
              <span className="meta">
                <span className="pix">ARCHIVO 400–800</span>
                <span className="nm">Archivo</span>
                <span className="use">{t.x15}</span>
              </span>
              <span className="spec">
                <span
                  className="big"
                  style={{
                    fontFamily: "'Archivo',sans-serif",
                    fontWeight: "800",
                    letterSpacing: "-.05em",
                    color: "var(--burg)",
                    fontSize: "150px",
                  }}
                >
                  {t.x16}
                </span>
              </span>
            </div>
            <div className="tline" data-a="up" data-d="0">
              <span className="meta">
                <span className="pix">INSTRUMENT SERIF ITALIC</span>
                <span className="nm">Instrument Serif</span>
                <span className="use">{t.x17}</span>
              </span>
              <span className="spec">
                <span
                  className="big"
                  style={{
                    fontFamily: "'Instrument Serif',serif",
                    fontStyle: "italic",
                    fontSize: "80px",
                  }}
                >
                  {t.x18}
                </span>
              </span>
            </div>
            <div className="tline" data-a="up" data-d="0">
              <span className="meta">
                <span className="pix">SILKSCREEN</span>
                <span className="nm">Silkscreen</span>
                <span className="use">{t.x19}</span>
              </span>
              <span className="spec">
                <span
                  className="big"
                  style={{
                    fontFamily: "'Silkscreen',monospace",
                    fontSize: "56px",
                  }}
                >
                  {t.side} · 0123456789
                </span>
              </span>
            </div>
            <div className="tline" data-a="up" data-d="0">
              <span className="meta">
                <span className="pix">LA BELLE AURORE</span>
                <span className="nm">{t.x21}</span>
                <span className="use">{t.x22}</span>
              </span>
              <span className="spec">
                <span
                  className="big"
                  style={{
                    fontFamily: "'La Belle Aurore',cursive",
                    color: "var(--pen)",
                    fontSize: "60px",
                  }}
                >
                  {t.x21}
                </span>
              </span>
            </div>
          </div>
          <div className="scale" aria-hidden="true" data-a="up" data-d="0">
            <span style={{ fontSize: "150px" }}>
              Aa<small>150</small>
            </span>
            <span style={{ fontSize: "88px" }}>
              Aa<small>88</small>
            </span>
            <span style={{ fontSize: "64px" }}>
              Aa<small>64</small>
            </span>
            <span style={{ fontSize: "44px" }}>
              Aa<small>44</small>
            </span>
            <span style={{ fontSize: "30px" }}>
              Aa<small>30</small>
            </span>
            <span style={{ fontSize: "19px" }}>
              Aa<small>19</small>
            </span>
            <span style={{ fontSize: "17px" }}>
              Aa<small>17</small>
            </span>
            <span style={{ fontSize: "15px" }}>
              Aa<small>15</small>
            </span>
            <span style={{ fontSize: "12px" }}>
              Aa<small>12</small>
            </span>
          </div>
        </section>
        <section className="sx wrap" id="pp-s3" aria-labelledby="pp-sh3">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-sh3">
              {t.s3}
              <span className="ser">{t.s3b}</span>
            </h2>
          </div>
          <div className="objs">
            <div className="obj" data-a="up" data-d="0">
              <div className="stage" aria-hidden="true">
                <span className="vinyl" aria-hidden="true">
                  <span className="sheen"></span>
                  <span className="lbl">
                    <span className="t1 hand">refrain</span>
                    <span className="t2 pix">{t.side}</span>
                  </span>
                </span>
              </div>
              <p className="nm pix">{t.x28}</p>
              <p className="use">{t.x29}</p>
            </div>
            <div className="obj" data-a="up" data-d="1">
              <div className="stage" aria-hidden="true">
                <div className="mini-sl">
                  <span className="vinyl" aria-hidden="true">
                    <span className="sheen"></span>
                    <span className="lbl">
                      <span className="t1 hand">{t.x16}</span>
                      <span className="t2 pix">{t.side}</span>
                    </span>
                  </span>
                  <div className="card">
                    <b>{t.x16}</b>
                    <span className="covx" aria-hidden="true" />
                    <span className="hand">{t.x21}</span>
                  </div>
                </div>
              </div>
              <p className="nm pix">{t.x30}</p>
              <p className="use">{t.x31}</p>
            </div>
            <div className="obj" data-a="up" data-d="2">
              <div className="stage" aria-hidden="true">
                <div className="trk">
                  <div className="trow" style={{ cursor: "inherit" }}>
                    <span className="no">04</span>
                    <span className="nm">
                      <span className="tt">
                        {t.x16}
                        <svg
                          className="penring"
                          viewBox="0 0 160 40"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <path
                            pathLength="1"
                            d="M14.9 12.2 Q30.5 9.6 37.4 8.1 Q44.4 6.6 53.2 5.3 Q62.1 3.9 73 4.1 Q84 4.3 94.4 4.7 Q104.7 5.1 112.1 6.6 Q119.5 8.2 127.9 9.3 Q136.2 10.3 144 11.8 Q151.8 13.2 155.5 15.3 Q159.3 17.3 154 19.3 Q148.7 21.4 150 23.4 Q151.3 25.5 150.1 27.9 Q149 30.3 138.6 31.3 Q128.2 32.4 119.4 33.6 Q110.6 34.8 100.3 35.7 Q90.1 36.5 79.9 35.2 Q69.6 33.9 59.2 34 Q48.7 34.1 39.3 33.1 Q29.9 32.2 22 30.7 Q14 29.3 7.8 27.4 Q1.5 25.6 0.2 23.4 Q-1.1 21.2 2.4 19.1 Q5.9 17 8.3 15 Q10.7 13 16.1 11.2 Q21.6 9.4 29.4 7.9 Q37.3 6.5 47 5.6 Q56.8 4.7 67.4 4 L78 3.3"
                          ></path>
                        </svg>
                      </span>
                      <span className="note hand">{t.fav}</span>
                    </span>
                    <span className="rv hand">★</span>
                    <span className="pl"></span>
                  </div>
                </div>
              </div>
              <p className="nm pix">{t.x32}</p>
              <p className="use">{t.x33}</p>
            </div>
            <div className="obj" data-a="up" data-d="0">
              <div className="stage navy" aria-hidden="true">
                <span className="pol" style={{ rotate: "-3deg" }}>
                  <span className="pin"></span>
                  <span className="pg" style={{ aspectRatio: "0.8" }} />
                  <span className="t hand">{t.x21}</span>
                </span>
              </div>
              <p className="nm pix">{t.x34}</p>
              <p className="use">{t.x35}</p>
            </div>
            <div className="obj" data-a="up" data-d="1">
              <div className="stage navy" aria-hidden="true">
                <span
                  className="kr hand"
                  style={{
                    position: "relative",
                    clipPath:
                      "polygon(3.7% 0.0%,0.8% 14.3%,3.7% 28.6%,4.3% 42.9%,2.2% 57.1%,0.4% 71.4%,0.2% 85.7%,3.0% 100.0%,97.8% 100.0%,96.9% 85.7%,98.5% 71.4%,98.5% 57.1%,95.0% 42.9%,96.0% 28.6%,98.8% 14.3%,95.9% 0.0%)",
                    fontSize: "30px",
                    rotate: "-3deg",
                  }}
                >
                  {t.undated}
                </span>
              </div>
              <p className="nm pix">{t.x36}</p>
              <p className="use">{t.x37}</p>
            </div>
            <div className="obj" data-a="up" data-d="2">
              <div className="stage" aria-hidden="true">
                <div className="lined">
                  <p className="hand">{t.x39}</p>
                </div>
              </div>
              <p className="nm pix">{t.x38}</p>
              <p className="use">{t.x39}</p>
            </div>
            <div className="obj" data-a="up" data-d="0">
              <div className="stage" aria-hidden="true">
                <figure className="print" style={{ margin: "0" }}>
                  <span className="pg" />
                  {/* eslint-disable-next-line @next/next/no-img-element -- a fixed decorative asset */}
                  <img
                    className="tp"
                    src="/v3/tape-a.png"
                    alt=""
                    style={{ left: "50%", top: "-24px", marginLeft: "-50px" }}
                  />
                </figure>
              </div>
              <p className="nm pix">{t.x40}</p>
              <p className="use">{t.x41}</p>
            </div>
            <div className="obj" data-a="up" data-d="1">
              <div className="stage" aria-hidden="true">
                <div
                  className="tearx"
                  style={{
                    clipPath:
                      "polygon(0.0% -0.6%,3.8% 1.1%,7.7% 3.0%,11.5% 3.9%,15.4% 0.5%,19.2% -0.8%,23.1% -0.5%,26.9% 2.4%,30.8% 1.3%,34.6% 4.4%,38.5% 3.8%,42.3% 0.5%,46.2% 0.9%,50.0% 0.4%,53.8% 1.1%,57.7% 4.7%,61.5% 1.9%,65.4% 1.2%,69.2% 3.6%,73.1% 0.4%,76.9% -0.6%,80.8% 0.8%,84.6% 2.2%,88.5% 5.3%,92.3% 1.9%,96.2% 0.7%,100.0% 1.1%,100.0% 98.4%,96.2% 95.2%,92.3% 95.2%,88.5% 98.2%,84.6% 100.3%,80.8% 98.1%,76.9% 96.2%,73.1% 98.6%,69.2% 95.8%,65.4% 96.6%,61.5% 98.8%,57.7% 100.3%,53.8% 96.5%,50.0% 95.6%,46.2% 98.2%,42.3% 98.0%,38.5% 100.6%,34.6% 100.6%,30.8% 97.9%,26.9% 97.2%,23.1% 97.8%,19.2% 98.4%,15.4% 98.1%,11.5% 96.5%,7.7% 95.0%,3.8% 94.6%,0.0% 96.7%)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a fixed decorative asset */}
                  <img src="/v3/portrait-ph.jpg" alt="" />
                  <span className="phtag hand">{t.x42}</span>
                </div>
              </div>
              <p className="nm pix">{t.x42}</p>
              <p className="use">{t.x43}</p>
            </div>
            <div className="obj" data-a="up" data-d="2">
              <div className="stage edge" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- a fixed decorative asset */}
                <img className="torn-e" src="/v3/torn-top.png" alt="" />
                <div className="navyb"></div>
              </div>
              <p className="nm pix">{t.x44}</p>
              <p className="use">{t.x45}</p>
            </div>
            <div className="obj" data-a="up" data-d="0">
              <div className="stage" aria-hidden="true">
                <div className="btns">
                  <span className="pill">{t.readLatest}</span>
                  <span className="pill ghost">{t.allA}</span>
                </div>
              </div>
              <p className="nm pix">{t.x46}</p>
              <p className="use">{t.x47}</p>
            </div>
            <div className="obj" data-a="up" data-d="1">
              <div className="stage" aria-hidden="true">
                <div className="navs">
                  <div className="row">
                    <span>
                      {t.albums}
                      <svg
                        className="penring"
                        viewBox="0 0 120 50"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          pathLength="1"
                          d="M17.5 15.7 Q21.1 10.1 27 8.3 Q33 6.6 40.4 5.9 Q47.9 5.2 55.4 4.3 Q63 3.4 70.1 4.8 Q77.2 6.2 84.6 6.9 Q91.9 7.7 97.8 9.5 Q103.6 11.4 108 13.7 Q112.4 16 112.8 18.8 Q113.1 21.7 117.3 24.5 Q121.5 27.2 117.4 29.9 Q113.3 32.5 110.3 35.1 Q107.3 37.8 101.8 39.9 Q96.4 42 88.5 42.6 Q80.7 43.2 73.6 43.9 Q66.6 44.7 59 45.3 Q51.4 46 44.3 44.8 Q37.1 43.7 30.9 42.2 Q24.6 40.7 19.3 38.7 Q14.1 36.7 9.5 34.4 Q4.9 32.2 4.1 29.3 Q3.3 26.5 6.1 23.9 Q9 21.3 9.1 18.5 Q9.2 15.7 13 13.2 Q16.8 10.7 23.2 9.2 Q29.7 7.6 35.9 5.6 Q42.2 3.6 50.5 4.5 L58.7 5.3"
                        ></path>
                      </svg>
                    </span>
                    <span>{t.artists}</span>
                    <span>{t.memories}</span>
                  </div>
                  <div className="tl">
                    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        className="bx"
                        d="M4 9.5 H8 L13 5.5 V18.5 L8 14.5 H4 Z"
                      />
                      <path className="w1" d="M16 9 Q18 12 16 15" />
                      <path className="w2" d="M18.5 6.5 Q22.5 12 18.5 17.5" />
                    </svg>
                    <span>{t.snd}</span>
                    <span>EN / PT</span>
                  </div>
                </div>
              </div>
              <p className="nm pix">{t.x48}</p>
              <p className="use">{t.x49}</p>
            </div>
            <div className="obj" data-a="up" data-d="2">
              <div className="stage" aria-hidden="true">
                <div className="curs">
                  <span>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a fixed decorative asset */}
                    <img src="/v3/cur-rec.svg" alt="" />
                    <span className="pix">{t.x26}</span>
                  </span>
                  <span className="c2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a fixed decorative asset */}
                    <img src="/v3/cur-link.svg" alt="" />
                    <span className="pix">{t.x27}</span>
                  </span>
                </div>
              </div>
              <p className="nm pix">{t.x50}</p>
              <p className="use">{t.x51}</p>
            </div>
          </div>
        </section>
        <section className="sx wrap" id="pp-s4" aria-labelledby="pp-sh4">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-sh4">
              {t.s4}
              <span className="ser">{t.s4b}</span>
            </h2>
          </div>
          <div className="replay">
            <ReplayMotion label={t.replay} />
          </div>
          <div className="mot">
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span
                  data-a="drop"
                  data-d="0"
                  style={{ display: "inline-flex" }}
                >
                  <span className="sq"></span>
                </span>
              </div>
              <p className="nm pix">{t.x52}</p>
              <p className="use">{t.x53}</p>
            </div>
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span
                  data-a="place"
                  data-d="0"
                  style={{ display: "inline-flex" }}
                >
                  <span className="sq"></span>
                </span>
              </div>
              <p className="nm pix">{t.x54}</p>
              <p className="use">{t.x55}</p>
            </div>
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span
                  data-a="pop"
                  data-d="0"
                  style={{ display: "inline-flex" }}
                >
                  <span className="sq ph"></span>
                </span>
              </div>
              <p className="nm pix">{t.x56}</p>
              <p className="use">{t.x57}</p>
            </div>
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span
                  data-a="write"
                  data-d="0"
                  style={{ display: "inline-flex" }}
                >
                  <span className="wr hand">{t.x21}</span>
                </span>
              </div>
              <p className="nm pix">{t.x58}</p>
              <p className="use">{t.x59}</p>
            </div>
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span data-a="up" data-d="0" style={{ display: "inline-flex" }}>
                  <span className="sq"></span>
                </span>
              </div>
              <p className="nm pix">{t.x60}</p>
              <p className="use">{t.x61}</p>
            </div>
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span
                  data-a="word"
                  data-d="0"
                  style={{ display: "inline-flex" }}
                >
                  <span className="wd">{t.w2}</span>
                </span>
              </div>
              <p className="nm pix">{t.x62}</p>
              <p className="use">{t.x63}</p>
            </div>
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span
                  data-a="left"
                  data-d="0"
                  style={{ display: "inline-flex" }}
                >
                  <span className="sq"></span>
                </span>
              </div>
              <p className="nm pix">{t.x64}</p>
              <p className="use">{t.x65}</p>
            </div>
            <div className="mv">
              <div className="box demo" aria-hidden="true">
                <span
                  data-a="rec"
                  data-d="0"
                  style={{ display: "inline-flex" }}
                >
                  <span
                    style={{ width: "90px", height: "90px" }}
                    className="vinyl"
                    aria-hidden="true"
                  >
                    <span className="sheen"></span>
                    <span className="lbl">
                      <span className="t1 hand">refrain</span>
                      <span className="t2 pix"></span>
                    </span>
                  </span>
                </span>
              </div>
              <p className="nm pix">{t.x66}</p>
              <p className="use">{t.x67}</p>
            </div>
          </div>
          <div className="mot2">
            <p>
              <b>{t.x68}</b> {t.x69}
            </p>
            <p>
              <b>{t.x70}</b> {t.x71}
            </p>
            <p>
              <b>{t.x72}</b> {t.x73}
            </p>
            <p>
              <b>{t.x74}</b> {t.x75}
            </p>
          </div>
        </section>
        <section className="sx wrap" id="pp-s5" aria-labelledby="pp-sh5">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-sh5">
              {t.s5}
              <span className="ser">{t.s5b}</span>
            </h2>
          </div>
          <ul className="rows">
            <li>
              <span className="pix">{t.x76}</span>
              <span>{t.x77}</span>
            </li>
            <li>
              <span className="pix">{t.x78}</span>
              <span>{t.x79}</span>
            </li>
            <li>
              <span className="pix">{t.x80}</span>
              <span>{t.x81}</span>
            </li>
            <li>
              <span className="pix">{t.x82}</span>
              <span>{t.x83}</span>
            </li>
            <li>
              <span className="pix">{t.x84}</span>
              <span>{t.x85}</span>
            </li>
            <li>
              <span className="pix">{t.x86}</span>
              <span>{t.x87}</span>
            </li>
            <li>
              <span className="pix">{t.x88}</span>
              <span>{t.x89}</span>
            </li>
            <li>
              <span className="pix">{t.x90}</span>
              <span>{t.x91}</span>
            </li>
            <li>
              <span className="pix">{t.x92}</span>
              <span>{t.x93}</span>
            </li>
            <li>
              <span className="pix">{t.x94}</span>
              <span>{t.x95}</span>
            </li>
            <li>
              <span className="pix">{t.x96}</span>
              <span>{t.x97}</span>
            </li>
          </ul>
        </section>
        <section className="sx wrap" id="pp-s6" aria-labelledby="pp-sh6">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-sh6">
              {t.s6}
              <span className="ser">{t.s6b}</span>
            </h2>
          </div>
          <ul className="rows">
            <li>
              <span className="pix">{t.x98}</span>
              <span>{t.x99}</span>
            </li>
            <li>
              <span className="pix">{t.x100}</span>
              <span>{w.yourWords}</span>
            </li>
            <li>
              <span className="pix">{t.x102}</span>
              <span>{t.x103}</span>
            </li>
            <li>
              <span className="pix">{t.x104}</span>
              <span>{t.x105}</span>
            </li>
            <li>
              <span className="pix">{t.x106}</span>
              <span>{t.x107}</span>
            </li>
            <li>
              <span className="pix">{t.x108}</span>
              <span>{t.x109}</span>
            </li>
            <li>
              <span className="pix">{t.x110}</span>
              <span>{t.x111}</span>
            </li>
            <li>
              <span className="pix">{t.x112}</span>
              <span>{t.x113}</span>
            </li>
          </ul>
        </section>
        <section className="sx wrap" id="pp-s7" aria-labelledby="pp-sh7">
          <div className="shead" data-a="up" data-d="0">
            <h2 id="pp-sh7">
              {t.s7}
              <span className="ser">{t.s7b}</span>
            </h2>
          </div>
          <div className="grid12" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span className="lab pix">{t.grid}</span>
          </div>
        </section>
        <div style={{ height: "60px" }}></div>
      </main>
    </V3Frame>
  );
}
