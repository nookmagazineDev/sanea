import React from 'react';
import { Plus, Minus } from 'lucide-react';
import { menuImageCandidates } from '../utils/menuImage';

// memberLocked = เมนูเฉพาะสมาชิกที่ยังไม่ได้ยิงบัตรสมาชิก (กดแล้วหน้าขายเปิดหน้าต่างสแกนสมาชิกให้)
const FoodCard = ({ food, onOrderClick, onDecreaseClick, cartQuantity = 0, lang = 'th', displayPrice, disabled = false, disabledReason = '', memberLocked = false }) => {
  const name = lang === 'th' ? food.name : (food.nameEn || food.name);
  const desc = lang === 'th' ? food.description : (food.descriptionEn || food.description);

  // ลำดับรูปที่จะลองโหลด — ใช้ร่วมกับหน้าลูกค้า (utils/menuImage)
  const candidates = React.useMemo(() => menuImageCandidates(food), [food]);

  const [imgIdx, setImgIdx] = React.useState(0);
  React.useEffect(() => { setImgIdx(0); }, [food.id, candidates.length]);

  const imageSrc = imgIdx < candidates.length ? candidates[imgIdx] : null;
  const handleImageError = () => setImgIdx(i => i + 1);

  return (
    <div
      className={`pos-food-card ${cartQuantity > 0 ? 'in-cart' : ''} ${disabled ? 'unavailable' : ''}`}
      onClick={disabled ? undefined : () => onOrderClick(food)}
      title={disabled ? disabledReason : undefined}
    >
      <div className="pos-card-img-wrap">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={name}
            className="pos-card-img"
            loading="lazy"
            /* Google Drive ปฏิเสธการโหลดรูปข้ามเว็บเมื่อมี referrer ติดไปด้วย */
            referrerPolicy="no-referrer"
            onError={handleImageError}
          />
        ) : (
          <div className="pos-card-img-placeholder">🍽️</div>
        )}
        {cartQuantity > 0 && (
          <span className="pos-qty-badge">{cartQuantity}</span>
        )}
        {food.memberOnly === true && (
          <span style={{
            position: 'absolute', top: 6, left: 6, background: 'linear-gradient(135deg, #c8102e, #a50d25)', color: '#fff',
            fontWeight: 800, fontSize: '0.68rem', padding: '2px 7px', borderRadius: 20, border: '1.5px solid #fff', pointerEvents: 'none'
          }}>
            {memberLocked ? '🔒' : '👑'} {lang === 'th' ? 'สมาชิก' : 'Member'}
          </span>
        )}
      </div>

      <div className="pos-card-body">
        <h3 className="pos-card-name">{name}</h3>
        {desc && <p className="pos-card-desc">{desc}</p>}

        <div className="pos-card-footer">
          <span className={`pos-card-price ${disabled ? 'unavailable' : ''}`}>
            {disabled
              ? (lang === 'th' ? 'ยังไม่ตั้งราคา' : 'No price set')
              : `฿${Number(displayPrice != null ? displayPrice : food.price).toLocaleString()}`}
          </span>

          {disabled ? null : cartQuantity > 0 ? (
            <div className="pos-stepper" onClick={(e) => e.stopPropagation()}>
              <button
                className="pos-stepper-btn minus"
                onClick={(e) => { e.stopPropagation(); onDecreaseClick(food); }}
              >
                <Minus size={13} />
              </button>
              <span className="pos-stepper-qty">{cartQuantity}</span>
              <button
                className="pos-stepper-btn plus"
                onClick={(e) => { e.stopPropagation(); onOrderClick(food); }}
              >
                <Plus size={13} />
              </button>
            </div>
          ) : (
            <button
              className="pos-add-btn"
              onClick={(e) => { e.stopPropagation(); onOrderClick(food); }}
              title={lang === 'th' ? 'สั่ง' : 'Order'}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(FoodCard);
