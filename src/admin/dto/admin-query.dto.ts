import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole, UserStatus, ClassStatus } from '@prisma/client';

export class PaginationDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  limit?: number = 20;
}

export class ListUsersDto extends PaginationDto {
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @IsString()
  @IsOptional()
  search?: string;
}

export class ListClassesDto extends PaginationDto {
  @IsEnum(ClassStatus)
  @IsOptional()
  status?: ClassStatus;
}

export class ListAuditLogsDto extends PaginationDto {
  @IsString()
  @IsOptional()
  action?: string;

  @IsUUID('4')
  @IsOptional()
  actorUserId?: string;

  @IsString()
  @IsOptional()
  targetType?: string;

  @IsString()
  @IsOptional()
  from?: string; // ISO date

  @IsString()
  @IsOptional()
  to?: string; // ISO date
}
