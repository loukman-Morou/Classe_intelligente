import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProfessorCourseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}
