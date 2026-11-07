export type SkeletonShape = 'line' | 'block' | 'circle';

export type SkeletonWidth = 'full' | 'three-quarters' | 'half' | 'quarter';

export type SkeletonHeight = 'sm' | 'md' | 'lg';

export type SkeletonProps = Readonly<{
  shape?: SkeletonShape;
  width?: SkeletonWidth;
  height?: SkeletonHeight;
}>;
