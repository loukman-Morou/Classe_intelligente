import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProposalStatus } from '@prisma/client';

export class ReviewProposalDto {
  @IsEnum([ProposalStatus.ACCEPTED, ProposalStatus.REJECTED])
  decision!: ProposalStatus.ACCEPTED | ProposalStatus.REJECTED;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  comment?: string;
}
