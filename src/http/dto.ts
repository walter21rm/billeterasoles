import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class OpenWalletDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ownerId!: string;
}

export class AmountDto {
  @ApiProperty({ example: 1500, description: 'Monto en céntimos. 1500 = S/ 15.00' })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amount!: number;

  @ApiPropertyOptional({ enum: ['PEN'] })
  @IsOptional()
  @IsIn(['PEN'])
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalReference?: string;
}

export class TransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceWalletId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetWalletId!: string;

  @ApiProperty({ example: 1500 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amount!: number;

  @ApiPropertyOptional({ enum: ['PEN'] })
  @IsOptional()
  @IsIn(['PEN'])
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalReference?: string;
}

export class ReverseDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class OwnerQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ownerId!: string;
}

export class ListMovementsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
