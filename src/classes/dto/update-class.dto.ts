import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateClassDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}[-\/]\d{4}$/, {
    message: 'academicYear doit être au format "2026-2027" ou "2026/2027".',
  })
  academicYear?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
