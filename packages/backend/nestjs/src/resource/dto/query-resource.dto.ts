import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryResourceDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['label', 'value', 'createdAt', 'updatedAt'])
  sort?: 'label' | 'value' | 'createdAt' | 'updatedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  // §6: skenario read_heavy wajib punya versi raw SQL kontrol (bypass ORM)
  @IsOptional()
  @IsBooleanString()
  raw?: string;
}
