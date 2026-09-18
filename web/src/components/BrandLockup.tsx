import brandMark from '../../../assets/images/brand-mark.png';

type BrandLockupProps = {
  size?: 'sm' | 'md';
};

export function BrandLockup({ size = 'sm' }: BrandLockupProps) {
  const markClass = size === 'md' ? 'size-8' : 'size-5';
  const textClass = size === 'md' ? 'text-sm' : 'text-xs';

  return (
    <div className="flex items-center gap-2">
      <img src={brandMark} alt="" className={markClass} />
      <p className={`${textClass} font-semibold text-primary`}>subly</p>
    </div>
  );
}
