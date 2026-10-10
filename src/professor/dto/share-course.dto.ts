import { IsUUID } from 'class-validator';

export class ShareCourseToClassDto {
  /** ID de la classe cible. Le professeur doit en être membre (ClassMember). */
  @IsUUID('4')
  classId!: string;
}
