import { ProductCard } from "@/ui/product-card";
import { application } from "@/shared/infrastructure/composition-root";
import Image from "next/image";
import Link from "next/link";

export default async function HomePage() {
  const products = await application.listProducts.execute();

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">FLOWERS FOR EVERY FEELING</p>
          <h1>
            想いに、花を選ぶ
            <br />
            <em>時間を。</em>
          </h1>
          <p className="hero-lead">
            うれしい、ありがとう、元気でね。
            <br />
            まだ名前のない気持ちにも、似合う花があります。
          </p>
          <Link className="text-link" href="/flowers">
            季節の花から選ぶ <span aria-hidden="true">→</span>
          </Link>
          <ul className="hero-assurances" aria-label="ご注文について">
            <li>最短3日後から</li>
            <li>お届け日指定</li>
            <li>カード無料</li>
          </ul>
          <span className="hero-index">VOL. 08 — SUMMER / AUTUMN</span>
        </div>
        <div className="hero-visual">
          <div className="hero-image-frame">
            <Image
              src="https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1500&q=90"
              alt="青空の下に咲く鮮やかな黄色い花"
              fill
              priority
              sizes="(max-width: 760px) 100vw, 58vw"
            />
          </div>
          <p className="vertical-copy">THE ART OF GIVING, ROOTED IN NATURE</p>
          <span className="sun-shape" aria-hidden="true" />
        </div>
      </section>

      <section className="intro-band" aria-label="BloomBoxの考え方">
        <p>花を選ぶことは、</p>
        <p>その人を想うこと。</p>
        <div className="intro-line" aria-hidden="true" />
        <p className="intro-small">
          旬の花と、その背景にある物語を
          <br />
          ひとつの箱に詰めてお届けします。
        </p>
      </section>

      <section className="collection section-shell">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SEASONAL COLLECTION</p>
            <h2>今、贈りたい花</h2>
            <p className="section-description">その時季に美しい花だけを、贈る場面まで想像して束ねました。</p>
          </div>
          <Link className="text-link" href="/flowers">
            すべて見る <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="product-grid">
          {products.map((product, index) => (
            <ProductCard key={product.id} product={product} index={index} />
          ))}
        </div>
      </section>

      <section className="how-it-works section-shell">
        <div className="dark-section-heading">
          <div>
            <p className="eyebrow">A GIFT, MADE PERSONAL</p>
            <h2>贈るまでの、3つの時間。</h2>
          </div>
          <p>花を決めてから、ご注文内容の確認まで約3分です。</p>
        </div>
        <ol className="steps">
          <li>
            <span>01</span>
            <h3>想いから選ぶ</h3>
            <p>贈る理由や相手の雰囲気から、今いちばん似合う花を。</p>
          </li>
          <li>
            <span>02</span>
            <h3>ことばを添える</h3>
            <p>あなたの言葉を、そのまま。短くても、きっと伝わります。</p>
          </li>
          <li>
            <span>03</span>
            <h3>農園から届ける</h3>
            <p>花の鮮度と物語を保ったまま、丁寧に箱へ詰めて。</p>
          </li>
        </ol>
      </section>
    </>
  );
}
