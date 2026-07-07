import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateResourceDto {
  @IsString()
  label: string;

  @IsInt()
  value: number;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;
}
